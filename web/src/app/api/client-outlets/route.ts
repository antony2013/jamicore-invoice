import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { outlets } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";

/**
 * Client's own outlets (mobile outlet picker at upload).
 * Identity strictly from JWT.
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
      orderBy: [asc(outlets.name)],
    });

    return NextResponse.json({
      success: true,
      outlets: rows.map((o) => ({ id: o.id, name: o.name })),
    });
  } catch (error: unknown) {
    console.error("Error in GET /api/client-outlets:", error);
    return NextResponse.json({ error: "Failed to fetch outlets" }, { status: 500 });
  }
}
