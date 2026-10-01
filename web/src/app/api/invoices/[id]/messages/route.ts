import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceMessages } from "@/db/schema";
import { auth } from "@/lib/auth";
import { officeInvoiceOr404 } from "@/lib/invoice-access";

/**
 * Office side of the per-invoice client↔staff thread.
 * Admin or the assigned staff member only.
 * GET marks the thread read for staff. POST writes as the office staffer.
 */

const postSchema = z.object({
  body: z.string().trim().min(1, "Message is empty").max(500),
});

function toPublic(m: typeof invoiceMessages.$inferSelect) {
  return {
    id: m.id,
    senderType: m.senderType,
    senderName: m.senderName,
    kind: m.kind,
    body: m.body,
    mine: m.senderType === "staff",
    createdAt: m.createdAt,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const found = await officeInvoiceOr404(id, session.user as any);
    if ("error" in found) return found.error;

    const rows = await db.query.invoiceMessages.findMany({
      where: eq(invoiceMessages.invoiceId, id),
      orderBy: [desc(invoiceMessages.createdAt)],
      limit: 100,
    });
    // Everything the client wrote is now seen by the office
    await db
      .update(invoiceMessages)
      .set({ isReadByStaff: true })
      .where(eq(invoiceMessages.invoiceId, id));
    return NextResponse.json({ success: true, messages: rows.map(toPublic) });
  } catch (error: any) {
    console.error("Error in GET /api/invoices/[id]/messages:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const me = session.user as any;
    const { id } = await params;
    const found = await officeInvoiceOr404(id, me);
    if ("error" in found) return found.error;

    const body = await request.json();
    const result = postSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const [created] = await db
      .insert(invoiceMessages)
      .values({
        invoiceId: id,
        senderType: "staff",
        senderId: me.id,
        senderName: me.name || (me.role === "admin" ? "Office admin" : "Office staff"),
        kind: "text",
        body: result.data.body,
        isReadByStaff: true,
        isReadByClient: false,
      })
      .returning();
    return NextResponse.json({ success: true, message: toPublic(created) }, { status: 201 });
  } catch (error: any) {
    console.error("Error in POST /api/invoices/[id]/messages:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
