import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { invoices, clients, staff } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { safeClient, safeStaff } from "@/lib/safe-columns";
import { touchPresence } from "@/lib/presence";

export async function GET(request: Request) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;

    const role = me.role;
    const staffId = me.id;
    touchPresence(staffId);

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const assignedToParam = searchParams.get("assigned_to");
    const outletParam = searchParams.get("outlet");
    const clientParam = searchParams.get("client");
    const categoryParam = searchParams.get("category");

    const UUID_RE = /^[0-9a-f-]{36}$/i;
    const VALID_STATUSES = [
      "uploaded", "ocr_pending", "ocr_done", "ocr_failed", "assigned",
      "in_review", "needs_info", "verified", "collected", "disputed",
    ];
    if (statusParam && !VALID_STATUSES.includes(statusParam)) {
      return NextResponse.json({ error: "Invalid status filter." }, { status: 400 });
    }
    for (const [label, v] of [["outlet", outletParam], ["client", clientParam], ["assigned_to", assignedToParam]] as const) {
      if (v && v !== "me" && !UUID_RE.test(v)) {
        return NextResponse.json({ error: `Invalid ${label} filter.` }, { status: 400 });
      }
    }

    let whereClause = undefined;
    const conditions = [];

    if (statusParam) {
      conditions.push(eq(invoices.status, statusParam as any));
    }

    // Strict separation: staff can only ever list their OWN invoices.
    // Any assigned_to value they pass is ignored in favor of their id.
    if (role !== "admin") {
      conditions.push(eq(invoices.assignedTo, staffId));
    } else if (assignedToParam === "me") {
      conditions.push(eq(invoices.assignedTo, staffId));
    } else if (assignedToParam) {
      conditions.push(eq(invoices.assignedTo, assignedToParam));
    }

    if (outletParam) {
      conditions.push(eq(invoices.outletId, outletParam));
    }

    if (clientParam) {
      conditions.push(eq(invoices.clientId, clientParam));
    }

    if (categoryParam) {
      conditions.push(eq(invoices.category, categoryParam as any));
    }

    if (conditions.length > 0) {
      whereClause = and(...conditions);
    }

    const invoiceList = await db.query.invoices.findMany({
      where: whereClause,
      with: {
        client: safeClient,
        assignedStaff: safeStaff,
        outlet: true,
      },
      orderBy: [desc(invoices.createdAt)],
    });

    return NextResponse.json({
      success: true,
      invoices: invoiceList,
    });
  } catch (error: any) {
    console.error("Error in GET /api/invoices:", error);
    return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 500 });
  }
}
