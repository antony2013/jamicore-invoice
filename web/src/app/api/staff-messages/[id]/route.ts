import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { staffMessages } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";

/** Mark a received staff message as read (recipient only). */
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const { id } = await params;
    const [row] = await db
      .update(staffMessages)
      .set({ isRead: true })
      .where(and(eq(staffMessages.id, id), eq(staffMessages.recipientId, me.id)))
      .returning({ id: staffMessages.id, isRead: staffMessages.isRead });

    if (!row) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: row });
  } catch (error: any) {
    console.error("Error in PATCH /api/staff-messages/[id]:", error);
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}
