import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { invoices, clients, staff } from "@/db/schema";
import { auth } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized. Please log in." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const assignedToParam = searchParams.get("assigned_to");
    const outletParam = searchParams.get("outlet");
    const clientParam = searchParams.get("client");

    let whereClause = undefined;
    const conditions = [];

    if (statusParam) {
      conditions.push(eq(invoices.status, statusParam as any));
    }

    if (assignedToParam === "me") {
      conditions.push(eq(invoices.assignedTo, (session.user as any).id));
    } else if (assignedToParam) {
      conditions.push(eq(invoices.assignedTo, assignedToParam));
    }

    if (outletParam) {
      conditions.push(eq(invoices.outletId, outletParam));
    }

    if (clientParam) {
      conditions.push(eq(invoices.clientId, clientParam));
    }

    if (conditions.length > 0) {
      whereClause = and(...conditions);
    }

    const invoiceList = await db.query.invoices.findMany({
      where: whereClause,
      with: {
        client: true,
        assignedStaff: true,
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
