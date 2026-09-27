import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { outlets } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";

/**
 * Client's own outlets (mobile outlet picker at upload + Branches screen).
 * Identity strictly from JWT. Both owner and team staff read.
 */
export async function GET(request: Request) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json(
        { error: "Unauthorized. Valid client Bearer token is required." },
        { status: 401 }
      );
    }

    const rows = await db.query.outlets.findMany({
      where: eq(outlets.clientId, client.clientId),
      with: { createdBy: true },
      orderBy: [asc(outlets.name)],
    });

    return NextResponse.json({
      success: true,
      outlets: rows.map((o) => ({
        id: o.id,
        name: o.name,
        address: o.address,
        phone: o.phone,
        createdByName: (o as any).createdBy?.name ?? null,
      })),
    });
  } catch (error: unknown) {
    console.error("Error in GET /api/client-outlets:", error);
    return NextResponse.json({ error: "Failed to fetch outlets" }, { status: 500 });
  }
}

// NOTE: branch creation from mobile was removed — outlets are managed by
// the office (admin web). This endpoint is read-only by design.
