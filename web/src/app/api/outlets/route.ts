import { NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, outlets } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { safeClient, safeClientStaff, safeStaff } from "@/lib/safe-columns";

const createOutletSchema = z.object({
  clientId: z.string().uuid("Invalid client ID"),
  name: z.string().min(2, "Outlet name must be at least 2 characters").max(100),
  address: z.string().max(300).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{7,15}$/, "Phone must be E.164 format")
    .optional(),
});

export async function GET(request: Request) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");

    const rows = await db.query.outlets.findMany({
      where: clientId ? eq(outlets.clientId, clientId) : undefined,
      with: { client: safeClient, createdBy: safeClientStaff, assignedStaff: safeStaff },
      orderBy: [asc(outlets.name)],
    });

    return NextResponse.json({
      success: true,
      outlets: rows.map((o) => ({
        id: o.id,
        name: o.name,
        address: o.address,
        phone: o.phone,
        clientId: o.clientId,
        clientName: (o as any).client?.name ?? "Unknown",
        createdByName: (o as any).createdBy?.name ?? null,
        assignedStaffId: (o as any).assignedStaffId ?? null,
        assignedStaffName: (o as any).assignedStaff?.name ?? null,
      })),
    });
  } catch (error: any) {
    console.error("Error fetching outlets:", error);
    return NextResponse.json({ error: "Failed to fetch outlets" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

    const body = await request.json();
    const result = createOutletSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const { clientId, name, address, phone } = result.data;

    const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    // Case-insensitive duplicate check ("Main" vs "main" collide)
    const dup = await db.query.outlets.findFirst({
      where: and(
        eq(outlets.clientId, clientId),
        sql`lower(${outlets.name}) = lower(${name.trim()})`
      ),
    });
    if (dup) {
      return NextResponse.json(
        { error: "This client already has an outlet with this name." },
        { status: 409 }
      );
    }

    const [created] = await db
      .insert(outlets)
      .values({
        clientId,
        name: name.trim(),
        address: address?.trim() || null,
        phone: phone ?? null,
      })
      .returning();

    return NextResponse.json(
      { success: true, message: "Outlet created.", outlet: created },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Error creating outlet:", error);
    return NextResponse.json({ error: "Failed to create outlet" }, { status: 500 });
  }
}
