import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceReports } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { touchPresence } from "@/lib/presence";
import { officeInvoiceOr404 } from "@/lib/invoice-access";
import { writeAudit, getClientIp } from "@/lib/audit";
import { deleteObjectFromS3 } from "@/lib/s3";

/**
 * Admin-only report delete. Removes the current report row AND its S3
 * object (DB first in-tx with an audit row, S3 only after commit —
 * same rule as db:purge). The invoice itself is untouched.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const { id } = await params;
    const [report] = await db
      .select()
      .from(invoiceReports)
      .where(eq(invoiceReports.id, id))
      .limit(1);
    if (!report) {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }

    // The invoice must still be visible (no deleting history out from
    // under soft-deleted invoices — purge owns that path).
    const found = await officeInvoiceOr404(report.invoiceId, me);
    if ("error" in found) return found.error;

    const ip = getClientIp(request);
    await db.transaction(async (tx) => {
      await tx.delete(invoiceReports).where(eq(invoiceReports.id, id));
      await writeAudit(tx, {
        actor: { type: "staff", id: me.id },
        action: "report.delete",
        entityType: "report",
        entityId: id,
        before: { fileName: report.fileName, invoiceId: report.invoiceId },
        ip,
      });
    });

    // S3 only after commit; a failure here is logged, the DB row is
    // already gone so the orphan sweep will catch the object.
    const s3Ok = await deleteObjectFromS3(report.s3Key);

    return NextResponse.json({ success: true, s3Deleted: s3Ok });
  } catch (error: any) {
    console.error("Error in DELETE /api/reports/[id]:", error);
    return NextResponse.json({ error: "Failed to delete report" }, { status: 500 });
  }
}
