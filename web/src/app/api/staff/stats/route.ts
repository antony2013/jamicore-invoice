import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auth } from "@/lib/auth";

/**
 * Per-staff workload counts for the admin view.
 * Groups CURRENTLY-assigned invoices (assigned_to) by status bucket:
 * - assigned: waiting to start
 * - inProgress: in_review + needs_info (actively verifying)
 * - verified: ready for collection
 * - collected: finished ✅
 * - disputed
 * - total: all rows currently pointing at the staff member
 *
 * Note: counts follow the CURRENT assignee (re-assignment moves the row).
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || (session.user as unknown as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    const raw = await db.execute(sql`
      SELECT assigned_to AS "staffId",
             COUNT(*) FILTER (WHERE status = 'assigned') AS "assigned",
             COUNT(*) FILTER (WHERE status IN ('in_review', 'needs_info')) AS "inProgress",
             COUNT(*) FILTER (WHERE status = 'verified') AS "verified",
             COUNT(*) FILTER (WHERE status = 'collected') AS "collected",
             COUNT(*) FILTER (WHERE status = 'disputed') AS "disputed",
             COUNT(*) AS "total"
      FROM invoices
      WHERE assigned_to IS NOT NULL
      GROUP BY assigned_to
    `);

    const rows = (Array.isArray(raw) ? raw : (raw as { rows?: unknown }).rows ?? []) as Array<{
      staffId: string;
      assigned: string | number;
      inProgress: string | number;
      verified: string | number;
      collected: string | number;
      disputed: string | number;
      total: string | number;
    }>;

    const stats: Record<string, { assigned: number; inProgress: number; verified: number; collected: number; disputed: number; total: number; clients: number }> = {};
    for (const r of rows) {
      stats[r.staffId] = {
        assigned: Number(r.assigned),
        inProgress: Number(r.inProgress),
        verified: Number(r.verified),
        collected: Number(r.collected),
        disputed: Number(r.disputed),
        total: Number(r.total),
        clients: 0,
      };
    }

    // Distinct clients currently routed to each staff (tracking)
    const rawClients = await db.execute(sql`
      SELECT assigned_to AS "staffId", COUNT(DISTINCT client_id) AS "clients"
      FROM invoices
      WHERE assigned_to IS NOT NULL
      GROUP BY assigned_to
    `);
    const clientRows = (Array.isArray(rawClients)
      ? rawClients
      : (rawClients as { rows?: unknown }).rows ?? []) as Array<{
      staffId: string;
      clients: string | number;
    }>;
    for (const r of clientRows) {
      if (stats[r.staffId]) stats[r.staffId].clients = Number(r.clients);
    }

    return NextResponse.json({ success: true, stats });
  } catch (error: any) {
    console.error("Error in GET /api/staff/stats:", error);
    return NextResponse.json({ error: "Failed to fetch staff stats" }, { status: 500 });
  }
}
