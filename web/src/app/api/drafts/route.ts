import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { messageDrafts } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";
import { officeInvoiceOr404 } from "@/lib/invoice-access";
import { safeClient } from "@/lib/safe-columns";

/**
 * Office message drafts (one per staff member + invoice).
 * GET → own drafts with invoice + client context, newest first.
 * POST { invoiceId, body } → upsert own draft (invoice must be visible:
 * admin any live invoice, staff own assigned only).
 */
export async function GET() {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const rows = await db.query.messageDrafts.findMany({
      where: eq(messageDrafts.staffId, me.id),
      with: {
        invoice: {
          columns: { id: true, status: true, category: true, createdAt: true, ocrData: true },
          with: { client: safeClient },
        },
      },
      orderBy: [desc(messageDrafts.updatedAt)],
      limit: 100,
    });

    return NextResponse.json({
      success: true,
      drafts: rows.map((d: any) => ({
        id: d.id,
        body: d.body,
        updatedAt: d.updatedAt,
        invoice: d.invoice
          ? {
              id: d.invoice.id,
              status: d.invoice.status,
              category: d.invoice.category,
              createdAt: d.invoice.createdAt,
              invoiceNo: d.invoice.ocrData?.invoiceNo ?? null,
            }
          : null,
        client: d.invoice?.client
          ? { id: d.invoice.client.id, name: d.invoice.client.name }
          : null,
      })),
    });
  } catch (error: any) {
    console.error("Error in GET /api/drafts:", error);
    return NextResponse.json({ error: "Failed to fetch drafts" }, { status: 500 });
  }
}

const draftSchema = z.object({
  invoiceId: z.string().uuid("Invalid invoice ID"),
  body: z.string().trim().min(1, "Draft is empty").max(2000),
});

export async function POST(request: Request) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const body = await request.json();
    const result = draftSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    // Visibility gate: staff can only draft on their own invoices.
    const found = await officeInvoiceOr404(result.data.invoiceId, me);
    if ("error" in found) return found.error;

    const [draft] = await db
      .insert(messageDrafts)
      .values({ staffId: me.id, invoiceId: result.data.invoiceId, body: result.data.body })
      .onConflictDoUpdate({
        target: [messageDrafts.staffId, messageDrafts.invoiceId],
        set: { body: result.data.body, updatedAt: new Date() },
      })
      .returning();

    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    console.error("Error in POST /api/drafts:", error);
    return NextResponse.json({ error: "Failed to save draft" }, { status: 500 });
  }
}
