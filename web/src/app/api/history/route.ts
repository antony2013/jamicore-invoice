import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { invoices, invoiceStatusLog } from "@/db/schema";
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

    const logs = await db.query.invoiceStatusLog.findMany({
      where: role === "admin" ? undefined : eq(invoiceStatusLog.changedBy, staffId),
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

    // Soft-deleted invoices vanish from the feed (their logs stay in the DB).
    const invoiceIds = [...new Set(logs.map((l) => l.invoiceId).filter(Boolean))] as string[];
    const deletedRows =
      invoiceIds.length > 0
        ? await db.query.invoices.findMany({
            where: inArray(invoices.id, invoiceIds),
            columns: { id: true, deletedAt: true },
          })
        : [];
    const deletedSet = new Set(
      deletedRows.filter((r) => r.deletedAt).map((r) => r.id)
    );
    const visible = logs.filter((l) => !deletedSet.has(l.invoiceId as string));

    const formatted = visible.map((l) => ({
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
