import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { safeClient, safeStaff } from "@/lib/safe-columns";
import { touchPresence } from "@/lib/presence";
import { decodeCursor, encodeCursor } from "@/lib/cursor";
import {
  buildInvoiceConditions,
  combineConditions,
  parseInvoiceFilters,
} from "@/lib/invoice-filters";

/**
 * Office invoice list (admin: all, staff: own) with server-side search and
 * keyset pagination. Params: status, assigned_to (me|unassigned|uuid, admin
 * only), outlet, client, category, priority, q, from, to, limit (default 50,
 * max 100), cursor -> nextCursor (null at end). Order: created_at DESC, id
 * DESC. Response shape keeps { success, invoices } and adds nextCursor.
 */
export async function GET(request: Request) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const { searchParams } = new URL(request.url);
    const parsed = parseInvoiceFilters(searchParams);
    if (parsed instanceof NextResponse) return parsed;

    const limitRaw = searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitRaw || "50", 10) || 50, 1), 100);

    const cursorRaw = searchParams.get("cursor");
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
    if (cursorRaw && !cursor) {
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }

    const conditions = await buildInvoiceConditions(parsed, me);
    if (cursor) {
      conditions.push(
        sql`(${invoices.createdAt}, ${invoices.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
      );
    }

    const rows = await db.query.invoices.findMany({
      where: combineConditions(conditions),
      with: {
        client: safeClient,
        assignedStaff: safeStaff,
        outlet: true,
      },
      orderBy: [desc(invoices.createdAt), desc(invoices.id)],
      limit: limit + 1, // +1 probes for a next page
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1] as typeof page[number] | undefined;
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor(last.createdAt as unknown as Date, last.id)
        : null;

    return NextResponse.json({
      success: true,
      invoices: page,
      nextCursor,
    });
  } catch (error: any) {
    console.error("Error in GET /api/invoices:", error);
    return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 500 });
  }
}
