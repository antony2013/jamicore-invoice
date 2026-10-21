import { NextResponse } from "next/server";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, invoiceMessages, invoices } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";

/**
 * Header notification feed for the office portal.
 * - admin: every client message + invoices waiting for triage (uploaded)
 * - staff: unread client mail + newly assigned invoices (own queue only)
 * GET  -> { success, unread, items[] }
 * POST -> marks all unread client messages in scope as read by staff
 */
export async function GET() {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const isAdmin = me.role === "admin";
    const scope = isAdmin ? undefined : eq(invoices.assignedTo, me.id);

    const unreadWhere = and(
      eq(invoiceMessages.senderType, "client"),
      eq(invoiceMessages.isReadByStaff, false),
      ...(scope ? [scope] : [])
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
        .limit(6),
      db
        .select({ n: count() })
        .from(invoiceMessages)
        .innerJoin(invoices, eq(invoiceMessages.invoiceId, invoices.id))
        .where(unreadWhere),
    ]);

    const actionStatuses = isAdmin ? (["uploaded"] as const) : (["assigned"] as const);
    const queueWhere = and(
      inArray(invoices.status, [...actionStatuses]),
      ...(scope ? [scope] : [])
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
        .limit(4),
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
        title: isAdmin ? "Invoice waiting for triage" : "New invoice assigned to you",
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

export async function POST() {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const isAdmin = me.role === "admin";
    const scope = isAdmin ? undefined : eq(invoices.assignedTo, me.id);

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
