import { NextResponse } from "next/server";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, invoiceMessages, invoices, staff } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";
import {
  buildInvoiceConditions,
  combineConditions,
  parseInvoiceFilters,
} from "@/lib/invoice-filters";

/**
 * Flat, email-style mailbox: ONE ROW PER MESSAGE (no threads, no chat).
 * - folder=inbox: client-sent messages, newest first.
 * - folder=sent:  office-sent messages, newest first.
 * - admin: all invoices; staff: their own queue scope.
 * Params: folder, client, limit (default 100, max 200).
 * Search is done client-side on the returned page (body + client + invoice).
 */
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

    const parsed = parseInvoiceFilters(searchParams);
    if (parsed instanceof NextResponse) return parsed;

    // The mailbox search is body-aware, so keep q out of the invoice filters.
    const conditions = await buildInvoiceConditions({ ...parsed, q: undefined }, me);
    const scope = combineConditions(conditions);

    const rows = await db
      .select({
        id: invoiceMessages.id,
        invoiceId: invoiceMessages.invoiceId,
        senderType: invoiceMessages.senderType,
        senderName: invoiceMessages.senderName,
        body: invoiceMessages.body,
        createdAt: invoiceMessages.createdAt,
        isReadByStaff: invoiceMessages.isReadByStaff,
        isReadByClient: invoiceMessages.isReadByClient,
        invoiceNo: invoices.ocrData,
        invoiceStatus: invoices.status,
        jobNumber: invoices.jobNumber,
        clientId: invoices.clientId,
        assignedStaffId: staff.id,
        assignedStaffName: staff.name,
      })
      .from(invoiceMessages)
      .innerJoin(invoices, eq(invoiceMessages.invoiceId, invoices.id))
      .leftJoin(staff, eq(invoices.assignedTo, staff.id))
      .where(
        and(
          eq(invoiceMessages.senderType, folder === "sent" ? "staff" : "client"),
          ...(scope ? [scope] : [])
        )
      )
      .orderBy(desc(invoiceMessages.createdAt), desc(invoiceMessages.id))
      .limit(limit);

    const clientIds = Array.from(new Set(rows.map((r) => r.clientId).filter(Boolean))) as string[];
    const clientRows = clientIds.length
      ? await db
          .select({ id: clients.id, name: clients.name })
          .from(clients)
          .where(inArray(clients.id, clientIds))
      : [];
    const clientById = new Map(clientRows.map((c) => [c.id, c]));

    const messages = rows.map((r) => {
      const client = clientById.get(r.clientId);
      const ocr = (r.invoiceNo || {}) as Record<string, unknown>;
      return {
        id: r.id,
        invoiceId: r.invoiceId,
        senderType: r.senderType,
        senderName: r.senderName,
        body: r.body,
        createdAt: r.createdAt,
        isReadByStaff: r.isReadByStaff,
        isReadByClient: r.isReadByClient,
        invoice: {
          id: r.invoiceId,
          invoiceNo: typeof ocr.invoiceNo === "string" ? ocr.invoiceNo : null,
          jobNumber: r.jobNumber,
          status: r.invoiceStatus,
        },
        client: client ? { id: client.id, name: client.name } : { id: "", name: "Unknown client" },
        assignedStaff: r.assignedStaffId
          ? { id: r.assignedStaffId, name: r.assignedStaffName ?? "Staff" }
          : null,
      };
    });

    const [unreadRow] = await db
      .select({ n: count() })
      .from(invoiceMessages)
      .innerJoin(invoices, eq(invoiceMessages.invoiceId, invoices.id))
      .where(
        and(
          eq(invoiceMessages.senderType, "client"),
          eq(invoiceMessages.isReadByStaff, false),
          ...(scope ? [scope] : [])
        )
      );

    return NextResponse.json({
      success: true,
      folder,
      messages,
      totalUnread: Number(unreadRow?.n ?? 0),
    });
  } catch (error: any) {
    console.error("Error in GET /api/messages:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}
