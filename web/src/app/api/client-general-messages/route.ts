import { NextResponse } from "next/server";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clientMessages } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";

/**
 * General office <-> client messages on the client app (no invoice needed).
 * GET  lists this client's thread and marks office messages read.
 * POST sends a message from the logged-in client owner or team member.
 */
const postSchema = z.object({
  body: z.string().trim().min(1, "Message is empty").max(500),
});

function toPublic(m: typeof clientMessages.$inferSelect, mySub: string) {
  return {
    id: m.id,
    senderType: m.senderType,
    senderName: m.senderName,
    body: m.body,
    mine: m.senderType === "client" && m.senderId === mySub,
    createdAt: m.createdAt,
  };
}

export async function GET(request: Request) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json(
        { error: "Unauthorized. Valid client Bearer token is required." },
        { status: 401 }
      );
    }

    const rows = await db.query.clientMessages.findMany({
      where: eq(clientMessages.clientId, client.clientId),
      orderBy: [desc(clientMessages.createdAt)],
      limit: 100,
    });

    const [unreadRow] = await db
      .select({ n: count() })
      .from(clientMessages)
      .where(
        and(
          eq(clientMessages.clientId, client.clientId),
          eq(clientMessages.senderType, "staff"),
          eq(clientMessages.isReadByClient, false)
        )
      );

    await db
      .update(clientMessages)
      .set({ isReadByClient: true })
      .where(
        and(
          eq(clientMessages.clientId, client.clientId),
          eq(clientMessages.senderType, "staff")
        )
      );

    return NextResponse.json({
      success: true,
      messages: rows.map((m) => toPublic(m, client.sub)),
      unread: Number(unreadRow?.n ?? 0),
    });
  } catch (error: any) {
    console.error("Error in GET /api/client-general-messages:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json(
        { error: "Unauthorized. Valid client Bearer token is required." },
        { status: 401 }
      );
    }

    const parsed = postSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid message." },
        { status: 400 }
      );
    }

    const [created] = await db
      .insert(clientMessages)
      .values({
        clientId: client.clientId,
        senderType: "client",
        senderId: client.sub,
        senderName: client.name || "Client",
        body: parsed.data.body,
        isReadByStaff: false,
        isReadByClient: true,
      })
      .returning();

    return NextResponse.json(
      { success: true, message: toPublic(created, client.sub) },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Error in POST /api/client-general-messages:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
