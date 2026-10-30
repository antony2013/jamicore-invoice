import { NextResponse } from "next/server";
import { and, count, desc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, invoiceMessages, invoices, notificationDismissals } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";
import { staffInvoiceScope } from "@/lib/invoice-access";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Header notification feed for the office portal.
 * - admin: every client message + invoices waiting for triage (uploaded)
 * - staff: unread client mail + newly assigned invoices (own queue only)
 * GET  -> { success, unread, items[] } (dismissed per-staff items are hidden)
 * POST -> marks all unread client messages in scope as read
 * POST { action: "dismiss", key } -> clears one notification (and reads the
 *        underlying client message so the counter drops by exactly one)
 */
export async function GET() {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const isAdmin = me.role === "admin";
    const scope = isAdmin ? undefined : staffInvoiceScope(me.id);

    const dismissedRows = await db
      .select({ key: notificationDismissals.notificationKey })
      .from(notificationDismissals)
      .where(eq(notificationDismissals.staffId, me.id));

    const dismissedMessageIds = dismissedRows
      .map((row) => row.key)
      .filter((key) => key.startsWith("msg-"))
      .map((key) => key.slice(4))
      .filter((id) => UUID_RE.test(id));
    const dismissedInvoiceIds = dismissedRows
      .map((row) => row.key)
      .filter((key) => key.startsWith("inv-"))
      .map((key) => key.slice(4))
      .filter((id) => UUID_RE.test(id));

    const unreadWhere = and(
      eq(invoiceMessages.senderType, "client"),
      eq(invoiceMessages.isReadByStaff, false),
      ...(scope ? [scope] : []),
      ...(dismissedMessageIds.length
        ? [notInArray(invoiceMessages.id, dismissedMessageIds)]
        : [])
    );

    const [unreadRows, unreadCountRows] = await Promise.all([
      db
        .select({
          id: invoiceMessages.id,
          invoiceId: invoiceMessages.invoiceId,
          senderName: invoiceMessages.senderName,
          kind: invoiceMessages.kind,
          body: invoiceMessages.body,
          createdAt: invoiceMessages.createdAt,
          clientId: invoices.clientId,
          clientName: clients.name,
        })
        .from(invoiceMessages)
        .innerJoin(invoices, eq(invoiceMessages.invoiceId, invoices.id))
        .innerJoin(clients, eq(invoices.clientId, clients.id))
        .where(unreadWhere)
        .orderBy(desc(invoiceMessages.createdAt))
        .limit(12),
      db
        .select({ n: count() })
        .from(invoiceMessages)
        .innerJoin(invoices, eq(invoiceMessages.invoiceId, invoices.id))
        .where(unreadWhere),
    ]);

    const actionStatuses = isAdmin ? (["uploaded"] as const) : (["uploaded", "assigned"] as const);
    const queueWhere = and(
      inArray(invoices.status, [...actionStatuses]),
      ...(scope ? [scope] : []),
      ...(dismissedInvoiceIds.length ? [notInArray(invoices.id, dismissedInvoiceIds)] : [])
    );

    const [queueRows, queueCountRows] = await Promise.all([
      db
        .select({
          id: invoices.id,
          status: invoices.status,
          createdAt: invoices.createdAt,
          clientName: clients.name,
        })
        .from(invoices)
        .innerJoin(clients, eq(invoices.clientId, clients.id))
        .where(queueWhere)
        .orderBy(desc(invoices.createdAt))
        .limit(8),
      db.select({ n: count() }).from(invoices).where(queueWhere),
    ]);

    const items = [
      ...unreadRows.map((m) => ({
        id: `msg-${m.id}`,
        type: m.kind === "request_report" ? "report_request" : "message",
        title:
          m.kind === "request_report"
            ? `Report request from ${m.clientName}`
            : `New message from ${m.clientName}`,
        body: (m.senderName ? `${m.senderName}: ` : "") + m.body,
        href: isAdmin ? `/admin/clients/${m.clientId}` : `/staff/messages?client=${m.clientId}`,
        createdAt: m.createdAt,
      })),
      ...queueRows.map((inv) => ({
        id: `inv-${inv.id}`,
        type: "invoice",
        title: isAdmin ? "Invoice waiting for triage" : "New invoice waiting in the queue",
        body: inv.clientName,
        href: isAdmin ? "/admin/dashboard" : `/staff/invoices/${inv.id}`,
        createdAt: inv.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);

    const unread = Number(unreadCountRows[0]?.n ?? 0) + Number(queueCountRows[0]?.n ?? 0);

    return NextResponse.json({ success: true, unread, items });
  } catch (error) {
    console.error("Error in GET /api/notifications:", error);
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const isAdmin = me.role === "admin";
    const scope = isAdmin ? undefined : staffInvoiceScope(me.id);

    const payload = (await request.json().catch(() => null)) as
      | { action?: string; key?: string }
      | null;

    if (payload?.action === "dismiss") {
      const key = typeof payload.key === "string" ? payload.key : "";
      const match = /^(msg|inv)-(.+)$/.exec(key);
      const targetId = match?.[2] ?? "";
      if (!match || !UUID_RE.test(targetId)) {
        return NextResponse.json({ error: "Invalid notification key" }, { status: 400 });
      }

      if (match[1] === "msg") {
        const [row] = await db
          .select({ id: invoiceMessages.id })
          .from(invoiceMessages)
          .innerJoin(invoices, eq(invoiceMessages.invoiceId, invoices.id))
          .where(and(eq(invoiceMessages.id, targetId), ...(scope ? [scope] : [])))
          .limit(1);
        if (!row) {
          return NextResponse.json({ error: "Notification not found" }, { status: 404 });
        }
        await db
          .update(invoiceMessages)
          .set({ isReadByStaff: true })
          .where(eq(invoiceMessages.id, targetId));
      } else {
        const [row] = await db
          .select({ id: invoices.id })
          .from(invoices)
          .where(and(eq(invoices.id, targetId), ...(scope ? [scope] : [])))
          .limit(1);
        if (!row) {
          return NextResponse.json({ error: "Notification not found" }, { status: 404 });
        }
      }

      await db
        .insert(notificationDismissals)
        .values({ staffId: me.id, notificationKey: key })
        .onConflictDoNothing();

      return NextResponse.json({ success: true, dismissed: key });
    }

    const updated = await db
      .update(invoiceMessages)
      .set({ isReadByStaff: true })
      .where(
        and(
          eq(invoiceMessages.senderType, "client"),
          eq(invoiceMessages.isReadByStaff, false),
          ...(scope
            ? [
                inArray(
                  invoiceMessages.invoiceId,
                  db.select({ id: invoices.id }).from(invoices).where(scope)
                ),
              ]
            : [])
        )
      )
      .returning({ id: invoiceMessages.id });

    return NextResponse.json({ success: true, marked: updated.length });
  } catch (error) {
    console.error("Error in POST /api/notifications:", error);
    return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
  }
}
