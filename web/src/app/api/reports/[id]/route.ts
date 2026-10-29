import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invoiceReports } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";
import { officeInvoiceOr404 } from "@/lib/invoice-access";
import { writeAudit, getClientIp } from "@/lib/audit";

/**
 * Report trash: DELETE = soft delete with a mandatory remark, POST = restore.
 *
 * Soft delete keeps the DB row AND the S3 object, so "Restore" in the Trash
 * view is a one-column update — nothing has to be re-uploaded. Trashed rows
 * are invisible to every normal listing (report library, invoice report GET)
 * and are only returned by GET /api/reports?trash=1.
 *
 * Allowed for admins, and for the staff member the invoice is assigned to
 * (officeInvoiceOr404 enforces that scope; anyone else gets a 404).
 */
const deleteSchema = z.object({
  // Why is this report being deleted? Shown in Trash next to the entry.
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500),
});

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "A delete reason is required." },
        { status: 400 }
      );
    }
    const reason = parsed.data.reason;

    const [report] = await db
      .select()
      .from(invoiceReports)
      .where(eq(invoiceReports.id, id))
      .limit(1);
    if (!report || report.deletedAt) {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }

    // The invoice must still be visible (no deleting history out from
    // under soft-deleted invoices — purge owns that path).
    const found = await officeInvoiceOr404(report.invoiceId, me);
    if ("error" in found) return found.error;

    await db.transaction(async (tx) => {
      await tx
        .update(invoiceReports)
        .set({ deletedAt: new Date(), deletedBy: me.id, deleteReason: reason })
        .where(eq(invoiceReports.id, id));
      await writeAudit(tx, {
        actor: { type: "staff", id: me.id },
        action: "report.delete",
        entityType: "report",
        entityId: id,
        before: { fileName: report.fileName, invoiceId: report.invoiceId },
        after: { reason, softDeleted: true },
        ip: getClientIp(request),
      });
    });

    return NextResponse.json({ success: true, softDeleted: true });
  } catch (error: any) {
    console.error("Error in DELETE /api/reports/[id]:", error);
    return NextResponse.json({ error: "Failed to delete report" }, { status: 500 });
  }
}

const postSchema = z.object({ action: z.literal("restore") });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
    }

    const [report] = await db
      .select()
      .from(invoiceReports)
      .where(and(eq(invoiceReports.id, id)))
      .limit(1);
    if (!report || !report.deletedAt) {
      return NextResponse.json({ error: "Report not found in trash." }, { status: 404 });
    }

    const found = await officeInvoiceOr404(report.invoiceId, me);
    if ("error" in found) return found.error;

    // A newer live report for the same invoice would make the restored one a
    // second "current" report — refuse instead of silently creating a duplicate.
    const [live] = await db
      .select({ id: invoiceReports.id, fileName: invoiceReports.fileName })
      .from(invoiceReports)
      .where(
        and(eq(invoiceReports.invoiceId, report.invoiceId), isNull(invoiceReports.deletedAt))
      )
      .limit(1);
    if (live) {
      return NextResponse.json(
        {
          error: `A newer report (${live.fileName}) already exists for this invoice. Delete that one first, or keep this in Trash.`,
        },
        { status: 409 }
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .update(invoiceReports)
        .set({ deletedAt: null, deletedBy: null, deleteReason: null })
        .where(eq(invoiceReports.id, id));
      await writeAudit(tx, {
        actor: { type: "staff", id: me.id },
        action: "report.restore",
        entityType: "report",
        entityId: id,
        after: { fileName: report.fileName, invoiceId: report.invoiceId },
        ip: getClientIp(request),
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error in POST /api/reports/[id]:", error);
    return NextResponse.json({ error: "Failed to restore report" }, { status: 500 });
  }
}
