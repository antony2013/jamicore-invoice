import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clientRecords } from "@/db/schema";
import { CLIENT_RECORD_STATUSES } from "@/lib/client-records";
import { requireAdmin } from "@/lib/session";
import { writeAudit, getClientIp } from "@/lib/audit";
import { handleRouteError } from "@/lib/http-errors";

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  amount: z.coerce.number().min(0).max(999_999_999).optional(),
  recordDate: z.string().trim().max(10).nullable().optional(),
  status: z.enum(CLIENT_RECORD_STATUSES).optional(),
  assignedTo: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  workCategory: z.string().trim().max(100).nullable().optional(),
  quantity: z.coerce.number().min(0).max(999_999).optional(),
  rate: z.coerce.number().min(0).max(999_999_999).optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  overallDiscountPercent: z.coerce.number().min(0).max(100).optional(),
  taxPercent: z.coerce.number().min(0).max(100).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

    const { id } = await params;
    const existing = await db.query.clientRecords.findFirst({
      where: eq(clientRecords.id, id),
    });
    if (!existing) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid record." },
        { status: 400 }
      );
    }

    const d = parsed.data;
    const patch: Record<string, unknown> = {};
    if (d.title !== undefined) patch.title = d.title;
    if (d.amount !== undefined) patch.amount = String(d.amount);
    if (d.recordDate !== undefined) patch.recordDate = d.recordDate || null;
    if (d.status !== undefined) patch.status = d.status;
    if (d.assignedTo !== undefined) patch.assignedTo = d.assignedTo || null;
    if (d.description !== undefined) patch.description = d.description || null;
    if (d.workCategory !== undefined) patch.workCategory = d.workCategory || null;
    if (d.quantity !== undefined) patch.quantity = String(d.quantity);
    if (d.rate !== undefined) patch.rate = String(d.rate);
    if (d.discountPercent !== undefined) patch.discountPercent = String(d.discountPercent);
    if (d.overallDiscountPercent !== undefined)
      patch.overallDiscountPercent = String(d.overallDiscountPercent);
    if (d.taxPercent !== undefined) patch.taxPercent = String(d.taxPercent);

    const [updated] = await db.transaction(async (tx) => {
      const row = Object.keys(patch).length
        ? (
            await tx
              .update(clientRecords)
              .set(patch)
              .where(eq(clientRecords.id, id))
              .returning()
          )[0]
        : existing;
      await writeAudit(tx, {
        actor: { type: "staff", id: me.id },
        action: "client.record_update",
        entityType: "client",
        entityId: existing.clientId,
        before: { id, title: existing.title, amount: existing.amount },
        after: { id, title: row.title, amount: row.amount },
        ip: getClientIp(request),
      });
      return [row];
    });

    return NextResponse.json({ success: true, record: updated });
  } catch (error: any) {
    return handleRouteError(error, "PATCH /api/client-records/[id]");
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
    const record = await db.query.clientRecords.findFirst({
      where: eq(clientRecords.id, id),
    });
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    await db.transaction(async (tx) => {
      await tx.delete(clientRecords).where(eq(clientRecords.id, id));
      await writeAudit(tx, {
        actor: { type: "staff", id: me.id },
        action: "client.record_delete",
        entityType: "client",
        entityId: record.clientId,
        before: { id: record.id, type: record.type, title: record.title },
        ip: getClientIp(request),
      });
    });

    return NextResponse.json({ success: true, message: "Record deleted." });
  } catch (error: any) {
    return handleRouteError(error, "DELETE /api/client-records/[id]");
  }
}
