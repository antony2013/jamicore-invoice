import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { invoiceReports, invoiceStatusLog, invoices } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { writeAudit, getClientIp } from "@/lib/audit";
import { notDeleted } from "@/lib/invoice-access";
import { safeClient, safeClientStaff, safeStaff } from "@/lib/safe-columns";
import { officeInvoiceOr404 } from "@/lib/invoice-access";
import {
  MAX_REPORT_BYTES,
  REPORT_CONTENT_TYPE,
  checkMagicBytes,
  deleteObjectFromS3,
  generatePresignedReportUploadUrl,
  generatePresignedViewUrl,
  inspectUploadObject,
  putObjectToS3,
} from "@/lib/s3";
import { buildInvoiceReportXlsx } from "@/lib/excel-report";

/**
 * Office Excel reports per invoice (admin or assigned staff only).
 * GET → latest report meta + short-lived download URL (null when none).
 * POST { action }:
 *   upload-url { contentLength } → presigned PUT for a staff .xlsx file
 *   confirm { s3Key, fileName } → verify + replace current report
 *   generate {} → server builds the .xlsx from invoice data + replaces
 * Only ONE current report per invoice (replace semantics — old file removed).
 */

async function latestReport(invoiceId: string) {
  return db.query.invoiceReports.findFirst({
    where: eq(invoiceReports.invoiceId, invoiceId),
    orderBy: [desc(invoiceReports.createdAt)],
  });
}

async function replaceReport(
  invoiceId: string,
  s3Key: string,
  fileName: string,
  source: string,
  staffId: string
) {
  const prev = await latestReport(invoiceId);
  const [created] = await db
    .insert(invoiceReports)
    .values({ invoiceId, s3Key, fileName, source, uploadedBy: staffId })
    .returning();
  // Remove the replaced file (best-effort) so S3 never accumulates stale reports
  if (prev && prev.s3Key !== s3Key) {
    await db.delete(invoiceReports).where(eq(invoiceReports.id, prev.id));
    await deleteObjectFromS3(prev.s3Key);
  }
  return created;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;

    const { id } = await params;
    const found = await officeInvoiceOr404(id, me);
    if ("error" in found) return found.error;

    const report = await latestReport(id);
    if (!report) {
      return NextResponse.json({ success: true, report: null });
    }
    const downloadUrl = await generatePresignedViewUrl(report.s3Key);
    return NextResponse.json({ success: true, report: { ...report, downloadUrl } });
  } catch (error: any) {
    console.error("Error in GET /api/invoices/[id]/report:", error);
    return NextResponse.json({ error: "Failed to fetch report" }, { status: 500 });
  }
}

const postSchema = z.object({
  action: z.enum(["upload-url", "confirm", "generate"]),
  contentLength: z.number().int().positive().max(MAX_REPORT_BYTES).optional(),
  s3Key: z.string().max(300).optional(),
  fileName: z.string().trim().min(1).max(120).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;

    const staffId = me.id;
    const { id } = await params;
    const found = await officeInvoiceOr404(id, me);
    if ("error" in found) return found.error;

    const body = await request.json();
    const result = postSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }
    const { action, contentLength, s3Key, fileName } = result.data;

    if (action === "upload-url") {
      const key = `reports/${id}/${randomUUID()}.xlsx`;
      const uploadUrl = await generatePresignedReportUploadUrl(key, contentLength);
      return NextResponse.json({ success: true, uploadUrl, s3Key: key });
    }

    if (action === "confirm") {
      if (!s3Key || !fileName) {
        return NextResponse.json({ error: "s3Key and fileName are required." }, { status: 400 });
      }
      if (!s3Key.startsWith(`reports/${id}/`) || !s3Key.toLowerCase().endsWith(".xlsx")) {
        return NextResponse.json({ error: "Report key does not belong to this invoice." }, { status: 400 });
      }
      const inspected = await inspectUploadObject(s3Key);
      if (!inspected.exists) {
        return NextResponse.json({ error: "File not found in storage. Upload first." }, { status: 400 });
      }
      // Uploaded reports must really be zips (Phase 2.4): wrong magic →
      // delete the object, reject the confirm.
      if (inspected.magicOk === false || inspected.size === undefined || inspected.size > MAX_REPORT_BYTES) {
        await deleteObjectFromS3(s3Key);
        return NextResponse.json(
          { error: inspected.magicOk === false ? "File is not a valid .xlsx (bad magic bytes)." : "Report file is too large." },
          { status: 400 }
        );
      }
      const safeName = fileName.toLowerCase().endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
      const created = await replaceReport(id, s3Key, safeName, "uploaded", staffId);
      await writeAudit(db, {
        actor: { type: "staff", id: staffId },
        action: "report.upload",
        entityType: "invoice",
        entityId: id,
        after: { fileName: created.fileName },
        ip: getClientIp(request),
      });
      return NextResponse.json({ success: true, report: created });
    }

    // action === "generate": build the Excel from live invoice data
    // (officeInvoiceOr404 above already excluded soft-deleted rows)
    const full = await db.query.invoices.findFirst({
      where: and(eq(invoices.id, id), notDeleted()),
      with: { client: safeClient, assignedStaff: safeStaff, outlet: true, uploadedBy: safeClientStaff },
    });
    if (!full) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    const logs = await db.query.invoiceStatusLog.findMany({
      where: eq(invoiceStatusLog.invoiceId, id),
      with: { actor: safeStaff },
      orderBy: [desc(invoiceStatusLog.timestamp)],
    });
    const bytes = await buildInvoiceReportXlsx({
      id: full.id,
      status: full.status,
      priority: full.priority,
      category: (full as any).category,
      categoryDetail: (full as any).categoryDetail,
      clientNote: (full as any).clientNote,
      pageNotes: (full as any).pageNotes,
      createdAt: full.createdAt,
      updatedAt: full.updatedAt,
      ocrData: (full as any).ocrData,
      clientName: (full as any).client?.name,
      clientUsername: (full as any).client?.username,
      outletName: (full as any).outlet?.name,
      assignedStaffName: (full as any).assignedStaff?.name,
      uploadedByName: (full as any).uploadedBy?.name,
      timeline: logs.map((l) => ({
        status: l.status,
        note: l.note,
        timestamp: l.timestamp,
        actorName: (l as any).actor?.name ?? null,
      })),
    });
    const key = `reports/${id}/${randomUUID()}.xlsx`;
    await putObjectToS3(key, bytes, REPORT_CONTENT_TYPE);
    const stamp = new Date().toISOString().slice(0, 10);
    const created = await replaceReport(id, key, `invoice-report-${stamp}.xlsx`, "generated", staffId);
    await writeAudit(db, {
      actor: { type: "staff", id: staffId },
      action: "report.generate",
      entityType: "invoice",
      entityId: id,
      after: { fileName: created.fileName },
      ip: getClientIp(request),
    });
    return NextResponse.json({ success: true, report: created });
  } catch (error: any) {
    console.error("Error in POST /api/invoices/[id]/report:", error);
    return NextResponse.json({ error: "Failed to process report" }, { status: 500 });
  }
}
