import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { invoices, assignments, invoiceStatusLog, staff } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
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
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

    const adminId = me.id;
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
    // Re-assignable (assignee changes, status UNCHANGED): assigned,
    // in_review, needs_info. Terminal + verified stay blocked.
    const REASSIGNABLE = ["assigned", "in_review", "needs_info"];
    const isReassign = REASSIGNABLE.includes(currentInvoice.status);
    const allowed = isReassign
      ? true
      : isValidTransition(currentInvoice.status as InvoiceStatus, "assigned");
    if (!allowed) {
      return NextResponse.json(
        {
          error: `Cannot assign invoice in current status '${currentInvoice.status}'. Only uploaded (or legacy OCR-processed) invoices can be assigned; assigned / in-review / info-needed ones can be re-assigned.`,
        },
        { status: 400 }
      );
    }

    // Ensure target exists, is ACTIVE, and is a STAFF account (never an
    // admin — admins can't open the staff portal, so such invoices strand).
    const targetStaff = await db.query.staff.findFirst({
      where: eq(staff.id, staffId),
    });

    if (!targetStaff || targetStaff.role !== "staff" || targetStaff.isActive === false) {
      return NextResponse.json({ error: "Select an ACTIVE staff member (admin accounts cannot take invoices)." }, { status: 400 });
    }

    // Execute assignment in transaction (re-assign keeps the current status)
    const updatedInvoice = await db.transaction(async (tx) => {
      // 1. Update invoice
      const [inv] = await tx
        .update(invoices)
        .set({
          status: isReassign ? currentInvoice.status : "assigned",
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
        status: isReassign ? (currentInvoice.status as any) : "assigned",
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
