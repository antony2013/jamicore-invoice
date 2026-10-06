import { NextResponse } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, invoices, invoiceMessages, invoiceReports, invoiceStatusLog } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";
import { safeClientStaff } from "@/lib/safe-columns";
import { decodeCursor, encodeCursor } from "@/lib/cursor";
import { isClientEditable, isClientWithdrawable } from "@/lib/client-edit-rules";

/**
 * Invoice history (mobile "My History" screen).
 * - Owner (role client): every upload of the client (own + all team staff).
 * - Team staff: ONLY their own uploads. One member can never see, edit or
 *   withdraw another member's rows — enforced here, not just in the UI.
 * Each invoice carries its full status timeline (audit trail).
 * Keyset pagination: limit (default 50, max 100), cursor -> nextCursor.
 */
export async function GET(request: Request) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json(
        { error: "Unauthorized. Valid client Bearer token is required." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limitRaw = searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitRaw || "50", 10) || 50, 1), 100);
    const cursorRaw = searchParams.get("cursor");
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
    if (cursorRaw && !cursor) {
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }

    const scope =
      client.role === "client_staff"
        ? and(eq(invoices.clientId, client.clientId), eq(invoices.uploadedByStaffId, client.sub))
        : eq(invoices.clientId, client.clientId);

    const whereClause = cursor
      ? and(
          scope,
          sql`(${invoices.createdAt}, ${invoices.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
        )
      : scope;

    const rows = await db.query.invoices.findMany({
      where: whereClause,
      with: { outlet: true, uploadedBy: safeClientStaff },
      orderBy: [desc(invoices.createdAt), desc(invoices.id)],
      limit: limit + 1,
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null;

    // Which rows were manually assigned (admin hand involved)? One query.
    const manualRows =
      page.length > 0
        ? await db.query.assignments.findMany({
            where: inArray(
              assignments.invoiceId,
              page.map((r) => r.id)
            ),
            columns: { invoiceId: true },
          })
        : [];
    const manualSet = new Set(manualRows.map((r) => r.invoiceId));

    // Latest report per invoice + unread client-side messages — two queries.
    const ids = page.map((r) => r.id);
    const reportRows =
      ids.length > 0
        ? await db.query.invoiceReports.findMany({
            where: inArray(invoiceReports.invoiceId, ids),
            columns: { invoiceId: true, fileName: true, createdAt: true },
            orderBy: [desc(invoiceReports.createdAt)],
          })
        : [];
    const reportByInvoice = new Map<string, { fileName: string; createdAt: Date }>();
    for (const rep of reportRows) {
      if (!reportByInvoice.has(rep.invoiceId)) {
        reportByInvoice.set(rep.invoiceId, { fileName: rep.fileName, createdAt: rep.createdAt });
      }
    }
    const unreadRows =
      ids.length > 0
        ? await db.query.invoiceMessages.findMany({
            where: and(
              inArray(invoiceMessages.invoiceId, ids),
              eq(invoiceMessages.isReadByClient, false)
            ),
            columns: { invoiceId: true },
          })
        : [];
    const unreadByInvoice = new Map<string, number>();
    for (const m of unreadRows) {
      unreadByInvoice.set(m.invoiceId, (unreadByInvoice.get(m.invoiceId) ?? 0) + 1);
    }

    const withLogs = await Promise.all(
      page.map(async (inv) => {
        const logs = await db.query.invoiceStatusLog.findMany({
          where: eq(invoiceStatusLog.invoiceId, inv.id),
          orderBy: [desc(invoiceStatusLog.timestamp)],
        });
        const manual = manualSet.has(inv.id);
        return {
          id: inv.id,
          status: inv.status,
          priority: inv.priority,
          outlet: (inv as any).outlet ? { id: (inv as any).outlet.id, name: (inv as any).outlet.name } : null,
          ocrData: inv.ocrData
            ? {
                amount: (inv.ocrData as any).amount ?? null,
                invoiceNo: (inv.ocrData as any).invoiceNo ?? null,
                vendor: (inv.ocrData as any).vendor ?? null,
                date: (inv.ocrData as any).date ?? null,
                confidence: (inv.ocrData as any).confidence ?? null,
              }
            : null,
          clientNote: (inv as any).clientNote ?? null,
          pageNotes: ((inv as any).pageNotes as string[] | null) ?? null,
          uploadedByName: (inv as any).uploadedBy?.name ?? null,
          // Client withdrawal allowed within 1h of upload (server enforces)
          deletableUntil: new Date(new Date(inv.createdAt).getTime() + 60 * 60 * 1000).toISOString(),
          // UI mirrors: edit allowed pre-assignment + untouched auto-assigned
          editable: isClientEditable(inv.status, manual),
          withdrawable: isClientWithdrawable(inv.status, manual, inv.createdAt),
          category: (inv as any).category ?? "sales_invoice",
          categoryDetail: (inv as any).categoryDetail ?? null,
          // Office Excel report (null until staff shares one)
          report: reportByInvoice.get(inv.id) ?? null,
          // Unread staff messages on this invoice's thread
          unreadMessages: unreadByInvoice.get(inv.id) ?? 0,
          createdAt: inv.createdAt,
          updatedAt: inv.updatedAt,
          statusLogs: logs.map((l) => ({
            status: l.status,
            note: l.note,
            timestamp: l.timestamp,
          })),
        };
      })
    );

    return NextResponse.json({ success: true, invoices: withLogs, nextCursor });
  } catch (error: unknown) {
    console.error("Error in GET /api/client-invoices:", error);
    return NextResponse.json({ error: "Failed to fetch invoice history" }, { status: 500 });
  }
}
