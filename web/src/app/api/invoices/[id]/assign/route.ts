import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { invoices, assignments, invoiceStatusLog, staff } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isValidTransition, InvoiceStatus } from "@/lib/status-flow";

const assignSchema = z.object({
  staffId: z.string().uuid("Invalid staff ID"),
  priority: z.enum(["low", "normal", "urgent"]).optional(),
  note: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin privileges required." }, { status: 403 });
    }

    const adminId = (session.user as any).id;
    const { id } = await params;

    const body = await request.json();
    const result = assignSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const { staffId, priority, note } = result.data;

    // Fetch current invoice
    const currentInvoice = await db.query.invoices.findFirst({
      where: eq(invoices.id, id),
    });

    if (!currentInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Strictly validate against status transition matrix.
    // Assignable: freshly uploaded invoices, plus legacy ocr_done/ocr_failed
    // rows draining from before automated OCR was removed.
    const isReassign = currentInvoice.status === "assigned";
    const allowed = isReassign
      ? true
      : isValidTransition(currentInvoice.status as InvoiceStatus, "assigned");
    if (!allowed) {
      return NextResponse.json(
        {
          error: `Cannot assign invoice in current status '${currentInvoice.status}'. Only uploaded (or legacy OCR-processed) invoices can be assigned.`,
        },
        { status: 400 }
      );
    }

    // Ensure target exists and is a STAFF account (never an admin —
    // admins can't open the staff portal, so such invoices would strand).
    const targetStaff = await db.query.staff.findFirst({
      where: eq(staff.id, staffId),
    });

    if (!targetStaff || targetStaff.role !== "staff") {
      return NextResponse.json({ error: "Select a valid staff member (admin accounts cannot take invoices)." }, { status: 400 });
    }

    // Execute assignment in transaction
    const updatedInvoice = await db.transaction(async (tx) => {
      // 1. Update invoice
      const [inv] = await tx
        .update(invoices)
        .set({
          status: "assigned",
          assignedTo: staffId,
          ...(priority ? { priority } : {}),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, id))
        .returning();

      // 2. Insert into assignments table
      await tx.insert(assignments).values({
        invoiceId: id,
        staffId: staffId,
        assignedBy: adminId,
      });

      // 3. Insert audit log
      await tx.insert(invoiceStatusLog).values({
        invoiceId: id,
        status: "assigned",
        changedBy: adminId,
        note: note || (isReassign
          ? `Re-assigned to ${targetStaff.name} (${targetStaff.email})`
          : `Assigned to ${targetStaff.name} (${targetStaff.email})`),
      });

      return inv;
    });

    return NextResponse.json({
      success: true,
      message: "Invoice successfully assigned.",
      invoice: updatedInvoice,
    });
  } catch (error: any) {
    console.error("Error in /api/invoices/[id]/assign:", error);
    return NextResponse.json({ error: "Internal server error during assignment" }, { status: 500 });
  }
}
