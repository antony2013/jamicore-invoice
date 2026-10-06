import { NextResponse } from "next/server";
import { requireOffice } from "@/lib/session";
import { touchPresence } from "@/lib/presence";
import { computeInvoiceStats, parseInvoiceFilters } from "@/lib/invoice-filters";

/**
 * Server-computed dashboard numbers (admin: all, staff: own).
 * Honors the same filters as GET /api/invoices (status, outlet, client,
 * category, staff, priority, date range) — except the status breakdown,
 * which ignores the status filter itself so the cards stay meaningful.
 * Response: { success, stats: { byStatus, unassigned, byPriority, total } }.
 */
export async function GET(request: Request) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;
    touchPresence(me.id);

    const { searchParams } = new URL(request.url);
    const parsed = parseInvoiceFilters(searchParams);
    if (parsed instanceof NextResponse) return parsed;

    const stats = await computeInvoiceStats(parsed, me);
    return NextResponse.json({ success: true, stats });
  } catch (error: any) {
    console.error("Error in GET /api/invoices/stats:", error);
    return NextResponse.json({ error: "Failed to fetch invoice stats" }, { status: 500 });
  }
}
