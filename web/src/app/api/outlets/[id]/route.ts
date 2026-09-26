import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { assignments, invoices, invoiceStatusLog, outlets, staff } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isValidTransition } from "@/lib/status-flow";

const updateOutletSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  address: z.string().max(300).nullable().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{7,15}$/, "Phone must be E.164 format")
    .nullable()
    .optional(),
  // Default staff for THIS outlet (overrides client default). Null clears it.
  assignedStaffId: z.string().uuid("Invalid staff ID").nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const result = updateOutletSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const current = await db.query.outlets.findFirst({ where: eq(outlets.id, id) });
    if (!current) {
      return NextResponse.json({ error: "Outlet not found." }, { status: 404 });
    }

    const { name, address, phone, assignedStaffId } = result.data;
    if (name && name.trim() !== current.name) {
      const dup = await db.query.outlets.findFirst({
        where: and(
          eq(outlets.clientId, current.clientId),
          eq(outlets.name, name.trim()),
          ne(outlets.id, id)
        ),
      });
      if (dup) {
        return NextResponse.json(
          { error: "This client already has an outlet with this name." },
          { status: 409 }
        );
      }
    }

    if (assignedStaffId !== undefined && assignedStaffId !== null) {
      const target = await db.query.staff.findFirst({
        where: eq(staff.id, assignedStaffId),
      });
      if (!target || target.role !== "staff") {
        return NextResponse.json(
          { error: "Default staff must be an existing staff account." },
          { status: 400 }
        );
      }
    }

    const [updated] = await db
      .update(outlets)
      .set({
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(address !== undefined ? { address: address?.trim() || null } : {}),
        ...(phone !== undefined ? { phone: phone ?? null } : {}),
        ...(assignedStaffId !== undefined ? { assignedStaffId } : {}),
      })
      .where(eq(outlets.id, id))
      .returning();

    // Backlog sweep: unassigned invoices already tagged with this outlet
    // route to the new default immediately (admin is the assigner).
    let swept = 0;
    if (assignedStaffId) {
      const backlog = await db.query.invoices.findMany({
        where: and(eq(invoices.outletId, id), isNull(invoices.assignedTo)),
      });
      const adminId = (session.user as any).id;
      for (const inv of backlog) {
        if (!isValidTransition(inv.status as any, "assigned")) continue;
        await db.transaction(async (tx) => {
          await tx
            .update(invoices)
            .set({ status: "assigned", assignedTo: result.data.assignedStaffId, updatedAt: new Date() })
            .where(eq(invoices.id, inv.id));
          await tx.insert(assignments).values({
            invoiceId: inv.id,
            staffId: assignedStaffId,
            assignedBy: adminId,
          });
          await tx.insert(invoiceStatusLog).values({
            invoiceId: inv.id,
            status: "assigned",
            changedBy: adminId,
            note: "Bulk-assigned via outlet default staff",
          });
        });
        swept++;
      }
    }

    return NextResponse.json({ success: true, outlet: updated, swept });
  } catch (error: any) {
    console.error("Error updating outlet:", error);
    return NextResponse.json({ error: "Failed to update outlet" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    const { id } = await params;
    const inUse = await db.query.invoices.findFirst({ where: eq(invoices.outletId, id) });
    if (inUse) {
      return NextResponse.json(
        { error: "Cannot delete: invoices are linked to this outlet. Reassign them first." },
        { status: 409 }
      );
    }

    await db.delete(outlets).where(eq(outlets.id, id));
    return NextResponse.json({ success: true, message: "Outlet deleted." });
  } catch (error: any) {
    console.error("Error deleting outlet:", error);
    return NextResponse.json({ error: "Failed to delete outlet" }, { status: 500 });
  }
}
