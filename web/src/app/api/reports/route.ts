import { NextResponse } from "next/server";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { invoiceReports, invoices } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";
import { decodeCursor, encodeCursor } from "@/lib/cursor";
import { notDeleted } from "@/lib/invoice-access";
import { safeClient } from "@/lib/safe-columns";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Report library (read-only). Admin: everything; staff: assigned invoices. One current report per invoice
 * (replace semantics) — newest first. Params: client (uuid), limit
 * (default 50, max 100), cursor -> nextCursor (null at end).
 */
export async function GET(request: Request) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const { searchParams } = new URL(request.url);
    const client = searchParams.get("client")?.trim() || undefined;
    if (client && !UUID_RE.test(client)) {
      return NextResponse.json({ error: "Invalid client filter." }, { status: 400 });
    }
    const limitRaw = searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitRaw || "50", 10) || 50, 1), 100);
    const cursorRaw = searchParams.get("cursor");
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
    if (cursorRaw && !cursor) {
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }

    // Reports live on the invoices table's scope: resolve visible invoice
    // IDs first (client filter + soft-delete), then page the reports.
    const scope: SQL[] = [notDeleted()];
    // Staff only ever see reports on their own assigned invoices.
    if (me.role === "staff") scope.push(eq(invoices.assignedTo, me.id));
    if (client) scope.push(eq(invoices.clientId, client));
    const scopedInvoices = await db.query.invoices.findMany({
      where: and(...scope),
      columns: { id: true },
    });
    const scopedIds = scopedInvoices.map((i) => i.id);
    if (scopedIds.length === 0) {
      return NextResponse.json({ success: true, reports: [], nextCursor: null });
    }

    const conditions: SQL[] = [inArray(invoiceReports.invoiceId, scopedIds)];
    if (cursor) {
      conditions.push(
        sql`(${invoiceReports.createdAt}, ${invoiceReports.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
      );
    }

    const rows = await db.query.invoiceReports.findMany({
      where: and(...conditions),
      with: {
        invoice: {
          columns: {
            id: true,
            status: true,
            category: true,
            createdAt: true,
            ocrData: true,
          },
          with: { client: safeClient },
        },
      },
      orderBy: [desc(invoiceReports.createdAt), desc(invoiceReports.id)],
      limit: limit + 1,
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1] as typeof page[number] | undefined;
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor(last.createdAt as unknown as Date, last.id)
        : null;

    return NextResponse.json({
      success: true,
      reports: page.map((r: any) => ({
        id: r.id,
        fileName: r.fileName,
        notes: r.notes ?? null,
        source: r.source,
        createdAt: r.createdAt,
        uploadedBy: r.uploadedBy,
        invoice: r.invoice
          ? {
              id: r.invoice.id,
              status: r.invoice.status,
              category: r.invoice.category,
              createdAt: r.invoice.createdAt,
              invoiceNo: r.invoice.ocrData?.invoiceNo ?? null,
              amount: r.invoice.ocrData?.amount ?? null,
            }
          : null,
        client: r.invoice?.client
          ? { id: r.invoice.client.id, name: r.invoice.client.name }
          : null,
      })),
      nextCursor,
    });
  } catch (error: any) {
    console.error("Error in GET /api/reports:", error);
    return NextResponse.json({ error: "Failed to fetch reports" }, { status: 500 });
  }
}
