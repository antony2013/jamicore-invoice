import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assignments, invoices, invoiceStatusLog, staff } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { OPEN_INVOICE_STATUSES } from "@/lib/invoice-access";

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
        inArray(invoices.status, [...OPEN_INVOICE_STATUSES] as any)
      ),
      columns: { id: true, status: true },
    });

    await db.transaction(async (tx) => {
      for (const row of openRows) {
        await tx
          .update(invoices)
          .set({ assignedTo: toStaffId, updatedAt: new Date() })
          .where(eq(invoices.id, row.id));
        await tx.insert(assignments).values({
          invoiceId: row.id,
          staffId: toStaffId,
          assignedBy: me.id,
        });
        await tx.insert(invoiceStatusLog).values({
          invoiceId: row.id,
          status: row.status as any,
          changedBy: me.id,
          note: `Bulk re-assigned from ${source.name} to ${target.name}`,
        });
      }
    });

    return NextResponse.json({
      success: true,
      message: `Moved ${openRows.length} open invoice(s) from ${source.name} to ${target.name}.`,
      moved: openRows.length,
    });
  } catch (error: any) {
    console.error("Error in POST /api/staff/[id]/reassign-open:", error);
    return NextResponse.json({ error: "Failed to reassign invoices" }, { status: 500 });
  }
}
