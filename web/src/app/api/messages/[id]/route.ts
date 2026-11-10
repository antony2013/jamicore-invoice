import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceMessages } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";

/** Mark a single client message as read by the office (opening one email). */
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
      .update(invoiceMessages)
      .set({ isReadByStaff: true })
      .where(and(eq(invoiceMessages.id, id), eq(invoiceMessages.senderType, "client")))
      .returning({ id: invoiceMessages.id, isReadByStaff: invoiceMessages.isReadByStaff });

    if (!row) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: row });
  } catch (error: any) {
    console.error("Error in PATCH /api/messages/[id]:", error);
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}
