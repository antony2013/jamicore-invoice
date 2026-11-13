import { NextResponse } from "next/server";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clientMessages, clients, invoices } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";
import { staffInvoiceScope } from "@/lib/invoice-access";
import { copyClientMessageToAdmins } from "@/lib/client-message-copy";

/**
 * General office <-> client messages (Compose "To: Client"). These are plain
 * common communication and do NOT need an invoice. Invoice-scoped threads
 * stay in invoice_messages.
 *
 * GET  ?folder=inbox|sent  — one row per message, newest first.
 * POST { clientIds: string[], body: string } — send to one or more clients.
 *
 * Admin sees every client; staff are scoped to clients that have at least
 * one invoice in their queue (same scope as the invoice mailbox).
 */
const sendSchema = z.object({
  clientIds: z.array(z.string().uuid()).min(1).max(50),
  body: z.string().trim().min(1).max(500),
  /** Shared by every recipient row so one send groups as one mailbox row. */
  batchId: z.string().uuid().optional(),
});

function visibleClientIds(staffId: string) {
  return db
    .selectDistinct({ id: invoices.clientId })
    .from(invoices)
    .where(staffInvoiceScope(staffId));
}

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
    const limit = Math.min(Math.max(parseInt(limitRaw || "100", 10) || 100, 1), 200);
    const clientFilter = searchParams.get("client")?.trim() || "";

    const conditions = [
      eq(clientMessages.senderType, folder === "sent" ? "staff" : "client"),
    ];
    if (clientFilter) {
      conditions.push(eq(clientMessages.clientId, clientFilter));
    }
    if (me.role !== "admin") {
      conditions.push(inArray(clientMessages.clientId, visibleClientIds(me.id)));
      // Sent is personal: another staff member's (or the admin's) message must
      // never show up in this staff member's Sent folder.
      if (folder === "sent") {
        conditions.push(eq(clientMessages.senderId, me.id));
      }
    }

    const rows = await db
      .select({
        id: clientMessages.id,
        clientId: clientMessages.clientId,
        senderType: clientMessages.senderType,
        senderName: clientMessages.senderName,
        body: clientMessages.body,
        createdAt: clientMessages.createdAt,
        isReadByStaff: clientMessages.isReadByStaff,
        isReadByClient: clientMessages.isReadByClient,
        batchId: clientMessages.batchId,
        clientName: clients.name,
      })
      .from(clientMessages)
      .innerJoin(clients, eq(clients.id, clientMessages.clientId))
      .where(and(...conditions))
      .orderBy(desc(clientMessages.createdAt), desc(clientMessages.id))
      .limit(limit);

    const unreadConditions = [
      eq(clientMessages.senderType, "client"),
      eq(clientMessages.isReadByStaff, false),
    ];
    if (clientFilter) {
      unreadConditions.push(eq(clientMessages.clientId, clientFilter));
    }
    if (me.role !== "admin") {
      unreadConditions.push(inArray(clientMessages.clientId, visibleClientIds(me.id)));
    }
    const [unreadRow] = await db
      .select({ n: count() })
      .from(clientMessages)
      .where(and(...unreadConditions));

    return NextResponse.json({
      success: true,
      folder,
      messages: rows.map((r) => ({
        id: r.id,
        clientId: r.clientId,
        client: { id: r.clientId, name: r.clientName },
        senderType: r.senderType,
        senderName: r.senderName,
        body: r.body,
        createdAt: r.createdAt,
        isReadByStaff: r.isReadByStaff,
        isReadByClient: r.isReadByClient,
        batchId: r.batchId,
        general: true,
      })),
      totalUnread: Number(unreadRow?.n ?? 0),
    });
  } catch (error: any) {
    console.error("Error in GET /api/client-messages:", error);
    return NextResponse.json({ error: "Failed to fetch client messages" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const parsed = sendSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid message." },
        { status: 400 }
      );
    }

    const clientIds = Array.from(new Set(parsed.data.clientIds));

    if (me.role !== "admin") {
      const visible = await visibleClientIds(me.id);
      const allowed = new Set(visible.map((c) => c.id));
      if (clientIds.some((id) => !allowed.has(id))) {
        return NextResponse.json(
          { error: "You can only message clients in your queue." },
          { status: 403 }
        );
      }
    }

    const existing = await db
      .select({
        id: clients.id,
        name: clients.name,
      })
      .from(clients)
      .where(inArray(clients.id, clientIds));
    if (existing.length !== clientIds.length) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const batchId = parsed.data.batchId ?? crypto.randomUUID();

    const rows = await db
      .insert(clientMessages)
      .values(
        clientIds.map((clientId) => ({
          clientId,
          senderType: "staff",
          senderId: me.id,
          senderName: me.name || "Staff",
          body: parsed.data.body,
          isReadByStaff: true,
          isReadByClient: false,
          batchId,
        }))
      )
      .returning({ id: clientMessages.id, clientId: clientMessages.clientId });

    // A staff member writing to a client also lands a copy in every admin's
    // inbox. Admins see their own client messages already, so admin sends do
    // not create a copy. The client still receives exactly one message.
    let copyCount = 0;
    if (me.role !== "admin") {
      const nameById = new Map(existing.map((c) => [c.id, c.name]));
      const copied = await Promise.all(
        clientIds.map((clientId) =>
          copyClientMessageToAdmins({
            senderId: me.id,
            clientId,
            clientName: nameById.get(clientId) ?? "Client",
            body: parsed.data.body,
            batchId,
          })
        )
      );
      copyCount = copied.reduce((sum, n) => sum + n, 0);
    }

    return NextResponse.json(
      { success: true, messages: rows, batchId, adminCopies: copyCount },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Error in POST /api/client-messages:", error);
    return NextResponse.json({ error: "Failed to send client message" }, { status: 500 });
  }
}
