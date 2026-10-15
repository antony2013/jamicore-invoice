import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { messageDrafts } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";

/** Delete your own draft (e.g. after sending it as a real message). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const { id } = await params;
    const [gone] = await db
      .delete(messageDrafts)
      .where(and(eq(messageDrafts.id, id), eq(messageDrafts.staffId, me.id)))
      .returning({ id: messageDrafts.id });

    if (!gone) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error in DELETE /api/drafts/[id]:", error);
    return NextResponse.json({ error: "Failed to delete draft" }, { status: 500 });
  }
}
