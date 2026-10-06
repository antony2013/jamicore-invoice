import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { invoices, staff } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { notDeleted, OPEN_INVOICE_STATUSES } from "@/lib/invoice-access";
import { transitionInvoice } from "@/lib/invoice-transitions";
import { handleRouteError } from "@/lib/http-errors";
import { writeAudit } from "@/lib/audit";

const reassignSchema = z.object({
  toStaffId: z.string().uuid("Invalid target staff ID"),
});

/**
 * Bulk-move ALL open invoices (assigned, in_review, needs_info) from one
 * staff member to another active staffer, in ONE transaction. Each invoice
 * keeps its current status; an assignments row + status log row is written
 * per invoice (changedBy = the admin doing the move).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

    const { id: fromStaffId } = await params;
    const body = await request.json();
    const result = reassignSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }
    const { toStaffId } = result.data;
    if (toStaffId === fromStaffId) {
      return NextResponse.json({ error: "Source and target are the same account." }, { status: 400 });
    }

    const [source, target] = await Promise.all([
      db.query.staff.findFirst({ where: eq(staff.id, fromStaffId) }),
      db.query.staff.findFirst({ where: eq(staff.id, toStaffId) }),
    ]);
    if (!source) {
      return NextResponse.json({ error: "Source staff member not found." }, { status: 404 });
    }
    if (!target || target.role !== "staff" || target.isActive === false) {
      return NextResponse.json(
        { error: "Target must be an ACTIVE staff account (admins cannot take invoices)." },
        { status: 400 }
      );
    }

    const openRows = await db.query.invoices.findMany({
      where: and(
        eq(invoices.assignedTo, fromStaffId),
        inArray(invoices.status, [...OPEN_INVOICE_STATUSES] as any),
        notDeleted()
      ),
      columns: { id: true, status: true },
    });

    await db.transaction(async (tx) => {
      for (const row of openRows) {
        // Same-status move through the single helper: conditional on the
        // row still being open AND still assigned here (parallel moves
        // collide into 409 and roll back), plus log + audit rows.
        await transitionInvoice(tx, {
          invoiceId: row.id,
          expectedStatus: row.status,
          nextStatus: row.status,
          actor: { type: "staff", id: me.id, isAdmin: true },
          note: `Bulk re-assigned from ${source.name} to ${target.name}`,
          assignedTo: toStaffId,
          expectedAssignedTo: fromStaffId,
          allowSameStatus: true,
          assignment: { staffId: toStaffId, assignedBy: me.id },
        });
      }
      await writeAudit(tx, {
        actor: { type: "staff", id: me.id },
        action: "staff.bulk_reassign",
        entityType: "staff",
        entityId: fromStaffId,
        before: { openInvoices: openRows.map((r) => r.id) },
        after: { toStaffId, moved: openRows.length },
        meta: { from: source.name, to: target.name },
      });
    });

    return NextResponse.json({
      success: true,
      message: `Moved ${openRows.length} open invoice(s) from ${source.name} to ${target.name}.`,
      moved: openRows.length,
    });
  } catch (error: any) {
    return handleRouteError(error, "POST /api/staff/[id]/reassign-open");
  }
}
