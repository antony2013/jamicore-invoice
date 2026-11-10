import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientMessages } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";

/** Mark one general client message as read by the office. */
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
      .update(clientMessages)
      .set({ isReadByStaff: true })
      .where(
        and(eq(clientMessages.id, id), eq(clientMessages.senderType, "client"))
      )
      .returning({ id: clientMessages.id, isReadByStaff: clientMessages.isReadByStaff });

    if (!row) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: row });
  } catch (error: any) {
    console.error("Error in PATCH /api/client-messages/[id]:", error);
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}
