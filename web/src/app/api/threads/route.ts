import { NextResponse } from "next/server";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoiceMessages, invoices } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";
import { buildInvoiceConditions, combineConditions, parseInvoiceFilters } from "@/lib/invoice-filters";
import { safeClient } from "@/lib/safe-columns";

/**
 * Office mailbox (read-only aggregates — opening a thread still goes
 * through the per-invoice thread route, which marks it read).
 * - admin: all invoices; staff: own assigned invoices only.
 * - folder=inbox: threads whose LATEST message is client-sent
 *   (needs staff attention), plus any thread with unread client mail.
 * - folder=sent: threads whose LATEST message is staff-sent.
 * - unread: client-sent messages not yet read by staff, per invoice.
 * Params: folder (inbox|sent, default inbox), client, q, limit
 * (default 50, max 100). Ordered by latest activity DESC.
 */
export async function GET(request: Request) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const { searchParams } = new URL(request.url);
    const folder = searchParams.get("folder")?.trim() || "inbox";
    if (folder !== "inbox" && folder !== "sent") {
      return NextResponse.json({ error: "Invalid folder." }, { status: 400 });
    }
    const limitRaw = searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitRaw || "50", 10) || 50, 1), 100);

    const parsed = parseInvoiceFilters(searchParams);
    if (parsed instanceof NextResponse) return parsed;
    const conditions = await buildInvoiceConditions(parsed, me);

    // Latest messages first (bounded scan; grouped per invoice in code).
    const msgConds = [sql`${invoiceMessages.invoiceId} = ${invoices.id}`];
    if (folder === "sent") msgConds.push(eq(invoiceMessages.senderType, "staff"));

    const recent = await db
      .select({
        messageId: invoiceMessages.id,
        invoiceId: invoiceMessages.invoiceId,
        senderType: invoiceMessages.senderType,
        senderName: invoiceMessages.senderName,
        body: invoiceMessages.body,
        createdAt: invoiceMessages.createdAt,
        invId: invoices.id,
        invStatus: invoices.status,
        invCategory: invoices.category,
        invCreatedAt: invoices.createdAt,
        invNo: sql<string | null>`${invoices.ocrData}->>'invoiceNo'`,
        invAmount: sql<string | null>`${invoices.ocrData}->>'amount'`,
        clientId: invoices.clientId,
      })
      .from(invoiceMessages)
      .innerJoin(invoices, eq(invoiceMessages.invoiceId, invoices.id))
      .where(and(...msgConds, ...(combineConditions(conditions) ? [combineConditions(conditions)!] : [])))
      .orderBy(desc(invoiceMessages.createdAt), desc(invoiceMessages.id))
      .limit(500);

    // Unread = client-sent, not read by staff (same invoice scope).
    const unreadRows = await db
      .select({
        invoiceId: invoiceMessages.invoiceId,
        n: count(),
      })
      .from(invoiceMessages)
      .innerJoin(invoices, eq(invoiceMessages.invoiceId, invoices.id))
      .where(
        and(
          eq(invoiceMessages.senderType, "client"),
          eq(invoiceMessages.isReadByStaff, false),
          ...(combineConditions(conditions) ? [combineConditions(conditions)!] : [])
        )
      )
      .groupBy(invoiceMessages.invoiceId);

    const unreadByInvoice = new Map<string, number>(
      unreadRows.map((r) => [r.invoiceId, Number(r.n)])
    );

    // Client names for the touched invoices (bounded).
    const invoiceIds = Array.from(new Set(recent.map((r) => r.invoiceId))).slice(0, limit);
    const withClients = invoiceIds.length
      ? await db.query.invoices.findMany({
          where: sql`${invoices.id} IN (${sql.join(
            invoiceIds.map((v) => sql`${v}::uuid`),
            sql`, `
          )})`,
          columns: { id: true },
          with: { client: safeClient },
        })
      : [];
    const clientByInvoice = new Map<string, { id: string; name: string }>(
      withClients.map((i: any) => [i.id, { id: i.client?.id ?? "", name: i.client?.name ?? "Unknown" }])
    );

    const seen = new Set<string>();
    const threads: Array<Record<string, unknown>> = [];
    for (const r of recent) {
      if (seen.has(r.invoiceId)) continue;
      seen.add(r.invoiceId);
      // Inbox holds only threads awaiting staff attention (client wrote
      // last); staff-answered threads live in Sent only.
      if (folder === "inbox" && r.senderType !== "client") continue;
      if (threads.length >= limit) break;
      const client = clientByInvoice.get(r.invoiceId) ?? { id: "", name: "Unknown" };
      threads.push({
        invoiceId: r.invoiceId,
        status: r.invStatus,
        category: r.invCategory,
        invoiceNo: r.invNo,
        amount: r.invAmount,
        createdAt: r.invCreatedAt,
        client,
        lastBody: r.body,
        lastSenderType: r.senderType,
        lastSenderName: r.senderName,
        lastAt: r.createdAt,
        unread: unreadByInvoice.get(r.invoiceId) ?? 0,
      });
    }
    // Unread-only threads with no recent message in the scan window still
    // surface when they have unread client mail.
    if (folder === "inbox") {
      for (const [invoiceId, n] of unreadByInvoice) {
        if (seen.has(invoiceId) || threads.length >= limit) continue;
        seen.add(invoiceId);
        const client = clientByInvoice.get(invoiceId) ?? { id: "", name: "Unknown" };
        threads.push({
          invoiceId,
          status: null,
          category: null,
          invoiceNo: null,
          amount: null,
          createdAt: null,
          client,
          lastBody: null,
          lastSenderType: "client",
          lastSenderName: null,
          lastAt: null,
          unread: n,
        });
      }
    }

    const totalUnread = Array.from(unreadByInvoice.values()).reduce((a, b) => a + b, 0);

    return NextResponse.json({ success: true, threads, totalUnread });
  } catch (error: any) {
    console.error("Error in GET /api/threads:", error);
    return NextResponse.json({ error: "Failed to fetch threads" }, { status: 500 });
  }
}
