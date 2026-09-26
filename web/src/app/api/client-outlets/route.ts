import { NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
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

const createSchema = z.object({
  name: z.string().min(2, "Branch name must be at least 2 characters").max(100),
  address: z.string().max(300).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{7,15}$/, "Phone must be E.164 format")
    .optional(),
});

/**
 * Add a branch/outlet for the own client. Allowed for the OWNER and for
 * active TEAM STAFF (field staff add new shops on the spot). Records WHO
 * created it (team staff name, else null = owner/office).
 */
export async function POST(request: Request) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json(
        { error: "Unauthorized. Valid client Bearer token is required." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const result = createSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const { name, address, phone } = result.data;
    const dup = await db.query.outlets.findFirst({
      where: and(eq(outlets.clientId, client.clientId), eq(outlets.name, name.trim())),
    });
    if (dup) {
      return NextResponse.json(
        { error: "This branch already exists." },
        { status: 409 }
      );
    }

    const [created] = await db
      .insert(outlets)
      .values({
        clientId: client.clientId,
        name: name.trim(),
        address: address?.trim() || null,
        phone: phone ?? null,
        createdByStaffId: client.role === "client_staff" ? client.sub : null,
      })
      .returning({ id: outlets.id, name: outlets.name });

    return NextResponse.json(
      { success: true, message: `Branch "${created.name}" added.`, outlet: created },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error in POST /api/client-outlets:", error);
    return NextResponse.json({ error: "Failed to add branch" }, { status: 500 });
  }
}
