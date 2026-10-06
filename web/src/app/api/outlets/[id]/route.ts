import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { clientStaff, invoices, outlets, staff } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { notDeleted } from "@/lib/invoice-access";
import { isValidTransition } from "@/lib/status-flow";
import { transitionInvoice } from "@/lib/invoice-transitions";
import { handleRouteError } from "@/lib/http-errors";
import { writeAudit, getClientIp } from "@/lib/audit";

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
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

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

    // ONE transaction for update + audit + sweep (all-or-nothing).
    let swept = 0;
    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(outlets)
        .set({
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(address !== undefined ? { address: address?.trim() || null } : {}),
          ...(phone !== undefined ? { phone: phone ?? null } : {}),
          ...(assignedStaffId !== undefined ? { assignedStaffId } : {}),
        })
        .where(eq(outlets.id, id))
        .returning();

      if (assignedStaffId !== undefined) {
        await writeAudit(tx, {
          actor: { type: "staff", id: me.id },
          action: "outlet.default_staff",
          entityType: "outlet",
          entityId: id,
          after: { assignedStaffId },
          ip: getClientIp(request),
        });
      }

      // Backlog sweep: unassigned invoices already tagged with this outlet
      // route to the new default immediately (admin is the assigner).
      // Each row goes through transitionInvoice so a concurrent move aborts
      // with 409 and rolls everything back.
      if (assignedStaffId) {
        const backlog = await tx.query.invoices.findMany({
          where: and(eq(invoices.outletId, id), isNull(invoices.assignedTo), notDeleted()),
          columns: { id: true, status: true },
        });
        const adminId = me.id;
        for (const inv of backlog) {
          if (!isValidTransition(inv.status as any, "assigned")) continue;
          await transitionInvoice(tx, {
            invoiceId: inv.id,
            expectedStatus: inv.status,
            nextStatus: "assigned",
            actor: { type: "staff", id: adminId, isAdmin: true },
            note: "Bulk-assigned via outlet default staff",
            assignedTo: result.data.assignedStaffId,
            expectedAssignedTo: null,
            allowSameStatus: true,
            assignment: { staffId: assignedStaffId, assignedBy: adminId },
          });
          swept++;
        }
      }
      return [row];
    });

    return NextResponse.json({ success: true, outlet: updated, swept });
  } catch (error: any) {
    return handleRouteError(error, "PATCH /api/outlets/[id]");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

    const { id } = await params;
    const inUse = await db.query.invoices.findFirst({ where: eq(invoices.outletId, id) });
    if (inUse) {
      return NextResponse.json(
        { error: "Cannot delete: invoices are linked to this outlet. Reassign them first." },
        { status: 409 }
      );
    }

    // client_staff.outlet_id has no FK (avoids a circular reference), so
    // detach the members of this outlet first (they become "all branches").
    await db
      .update(clientStaff)
      .set({ outletId: null })
      .where(eq(clientStaff.outletId, id));
    await db.delete(outlets).where(eq(outlets.id, id));
    return NextResponse.json({ success: true, message: "Outlet deleted." });
  } catch (error: any) {
    console.error("Error deleting outlet:", error);
    return NextResponse.json({ error: "Failed to delete outlet" }, { status: 500 });
  }
}
