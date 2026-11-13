import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientRecords } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { writeAudit, getClientIp } from "@/lib/audit";
import { handleRouteError } from "@/lib/http-errors";

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
