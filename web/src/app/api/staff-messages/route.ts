import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { staff, staffMessages } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";

/**
 * Internal office notes (admin Compose → To: Staff). Never touched by a
 * client: these rows are staff↔staff only, unlike invoice_messages.
 */
const sendSchema = z.object({
  recipientIds: z.array(z.string().uuid()).min(1).max(50),
  body: z.string().trim().min(1).max(500),
  /** Shared by every recipient row so one send groups as one mailbox row. */
  batchId: z.string().uuid().optional(),
});

export async function GET() {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const inbox = await db
      .select({
        id: staffMessages.id,
        body: staffMessages.body,
        isRead: staffMessages.isRead,
        createdAt: staffMessages.createdAt,
        senderId: staffMessages.senderId,
        senderName: staff.name,
        batchId: staffMessages.batchId,
        source: staffMessages.source,
        clientId: staffMessages.clientId,
      })
      .from(staffMessages)
      .innerJoin(staff, eq(staff.id, staffMessages.senderId))
      .where(eq(staffMessages.recipientId, me.id))
      .orderBy(desc(staffMessages.createdAt))
      .limit(100);

    const sent = await db
      .select({
        id: staffMessages.id,
        body: staffMessages.body,
        createdAt: staffMessages.createdAt,
        recipientId: staffMessages.recipientId,
        recipientName: staff.name,
        batchId: staffMessages.batchId,
        source: staffMessages.source,
        clientId: staffMessages.clientId,
      })
      .from(staffMessages)
      .innerJoin(staff, eq(staff.id, staffMessages.recipientId))
      .where(eq(staffMessages.senderId, me.id))
      .orderBy(desc(staffMessages.createdAt))
      .limit(100);

    return NextResponse.json({
      success: true,
      inbox: inbox.map((m) => ({
        id: m.id,
        body: m.body,
        isRead: m.isRead,
        createdAt: m.createdAt,
        sender: { id: m.senderId, name: m.senderName },
        batchId: m.batchId,
        source: m.source,
        clientId: m.clientId,
      })),
      sent: sent.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        recipient: { id: m.recipientId, name: m.recipientName },
        batchId: m.batchId,
        source: m.source,
        clientId: m.clientId,
      })),
      unread: inbox.filter((m) => !m.isRead).length,
    });
  } catch (error: any) {
    console.error("Error in GET /api/staff-messages:", error);
    return NextResponse.json({ error: "Failed to fetch staff messages" }, { status: 500 });
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

    const recipients = Array.from(new Set(parsed.data.recipientIds)).filter(
      (id) => id !== me.id
    );
    if (recipients.length === 0) {
      return NextResponse.json({ error: "Pick at least one other staff member." }, { status: 400 });
    }

    const batchId = parsed.data.batchId ?? crypto.randomUUID();

    const rows = await db
      .insert(staffMessages)
      .values(
        recipients.map((recipientId) => ({
          senderId: me.id,
          recipientId,
          body: parsed.data.body,
          batchId,
        }))
      )
      .returning({ id: staffMessages.id });

    return NextResponse.json({ success: true, messages: rows, batchId }, { status: 201 });
  } catch (error: any) {
    console.error("Error in POST /api/staff-messages:", error);
    return NextResponse.json({ error: "Failed to send staff message" }, { status: 500 });
  }
}
