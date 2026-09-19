import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceStatusLog } from "@/db/schema";
import { auth } from "@/lib/auth";

/**
 * Activity / history feed for web roles.
 * - admin: full feed (all invoices, latest first).
 * - staff: "my activity" only (entries changed by the requesting staff member).
 * Staff can never pull the global feed — enforced server-side.
 */
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized. Please log in." }, { status: 401 });
    }

    const role = (session.user as any).role as string;
    const staffId = (session.user as any).id as string;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10) || 100, 200);

    const logs = await db.query.invoiceStatusLog.findMany({
      where: role === "admin" ? undefined : eq(invoiceStatusLog.changedBy, staffId),
      with: {
        actor: true,
        invoice: {
          with: {
            client: true,
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
