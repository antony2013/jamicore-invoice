import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceMessages } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";
import { clientInvoiceOr404 } from "@/lib/invoice-access";

/**
 * Client side of the per-invoice thread (owner + team staff, same visibility
 * as the invoice itself). GET marks the thread read for the client.
 * POST kinds: "text" (plain reply) or "request_report" ("please share the
 * report for this invoice" — body optional, defaults to a polite request).
 */

const postSchema = z.object({
  body: z.string().trim().max(500).optional().default(""),
  kind: z.enum(["text", "request_report"]).default("text"),
});

const REQUEST_REPORT_TEXT = "Please share the Excel report for this invoice.";

function toPublic(m: typeof invoiceMessages.$inferSelect, mySub: string) {
  return {
    id: m.id,
    senderType: m.senderType,
    senderName: m.senderName,
    kind: m.kind,
    body: m.body,
    mine: m.senderType === "client" && m.senderId === mySub,
    createdAt: m.createdAt,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json(
        { error: "Unauthorized. Valid client Bearer token is required." },
        { status: 401 }
      );
    }
    const { id } = await params;
    const found = await clientInvoiceOr404(id, client);
    if ("error" in found) return found.error;

    const rows = await db.query.invoiceMessages.findMany({
      where: eq(invoiceMessages.invoiceId, id),
      orderBy: [desc(invoiceMessages.createdAt)],
      limit: 100,
    });
    await db
      .update(invoiceMessages)
      .set({ isReadByClient: true })
      .where(eq(invoiceMessages.invoiceId, id));
    return NextResponse.json({
      success: true,
      messages: rows.map((m) => toPublic(m, client.sub)),
    });
  } catch (error: any) {
    console.error("Error in GET /api/client-invoices/[id]/messages:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json(
        { error: "Unauthorized. Valid client Bearer token is required." },
        { status: 401 }
      );
    }
    const { id } = await params;
    const found = await clientInvoiceOr404(id, client);
    if ("error" in found) return found.error;

    const body = await request.json();
    const result = postSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const kind = result.data.kind;
    const text = kind === "request_report" && !result.data.body ? REQUEST_REPORT_TEXT : result.data.body;
    if (!text) {
      return NextResponse.json({ error: "Message is empty." }, { status: 400 });
    }

    // Sender name comes from the token (owner name or team member name)
    const senderName = client.name || "Client";
    const [created] = await db
      .insert(invoiceMessages)
      .values({
        invoiceId: id,
        senderType: "client",
        senderId: client.sub,
        senderName,
        kind,
        body: text,
        isReadByStaff: false,
        isReadByClient: true,
      })
      .returning();
    return NextResponse.json(
      { success: true, message: toPublic(created, client.sub) },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Error in POST /api/client-invoices/[id]/messages:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
