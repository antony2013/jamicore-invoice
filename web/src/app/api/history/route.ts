import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoiceStatusLog } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { safeClient, safeStaff } from "@/lib/safe-columns";
import { touchPresence } from "@/lib/presence";

/**
 * Activity / history feed for web roles.
 * - admin: full feed (all invoices, latest first).
 * - staff: "my activity" only (entries changed by the requesting staff member).
 * Staff can never pull the global feed — enforced server-side.
 */
export async function GET(request: Request) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;

    const role = me.role;
    const staffId = me.id;
    touchPresence(staffId);
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10) || 100, 200);

    // Soft-deleted invoices vanish from the feed IN SQL (before limit):
    // a page returns the full requested count whenever enough live rows
    // exist. Their logs stay in the DB untouched. (Drizzle aliases the
    // outer table as "invoiceStatusLog" — reference the alias, not the
    // physical table name.)
    const liveInvoice = sql`EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = "invoiceStatusLog"."invoice_id"
        AND invoices.deleted_at IS NULL
    )`;
    const scopeCond =
      role === "admin" ? liveInvoice : and(eq(invoiceStatusLog.changedBy, staffId), liveInvoice);

    const logs = await db.query.invoiceStatusLog.findMany({
      where: scopeCond as any,
      with: {
        actor: safeStaff,
        invoice: {
          with: {
            client: safeClient,
          },
        },
      },
      orderBy: [desc(invoiceStatusLog.timestamp)],
      limit,
    });

    const formatted = logs.map((l) => ({
      id: l.id,
      status: l.status,
      note: l.note,
      timestamp: l.timestamp,
      actor: l.actor ? { name: l.actor.name, role: l.actor.role } : null, // null = automated system
      invoice: l.invoice
        ? {
            id: l.invoice.id,
            status: l.invoice.status,
            clientName: (l.invoice as any).client?.name ?? "Unknown",
          }
        : null,
    }));

    return NextResponse.json({ success: true, logs: formatted, scope: role === "admin" ? "all" : "mine" });
  } catch (error: any) {
    console.error("Error in GET /api/history:", error);
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}
