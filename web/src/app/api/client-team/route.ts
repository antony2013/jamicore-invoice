import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, clientStaff, outlets } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "User ID must be at least 3 characters")
  .max(50)
  .regex(/^[a-z0-9._-]+$/, "User ID may contain letters, numbers, dots, underscores and hyphens");

// Short numeric PIN for shop workers (4-6 digits). Low entropy by design —
// compensated by per-username rate limiting on login + bcrypt hashing.
const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{4,6}$/, "PIN must be 4-6 digits");

const createSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  username: usernameSchema,
  pin: pinSchema,
  // Which outlet this member works at (null = all/unspecified). Shown as a
  // label next to the member everywhere.
  outletId: z.string().uuid("Invalid outlet ID").nullable().optional(),
});

/** Require an authenticated OWNER (not team staff). Returns client or error. */
async function requireOwner(request: Request) {
  const client = await authenticateClientRequest(request);
  if (!client) {
    return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) as NextResponse };
  }
  if (client.role !== "client") {
    return { error: NextResponse.json({ error: "Only the client owner can manage the team." }, { status: 403 }) as NextResponse };
  }
  return { client };
}

export async function GET(request: Request) {
  const auth = await requireOwner(request);
  if ("error" in auth) return auth.error;

  const rows = await db.query.clientStaff.findMany({
    where: eq(clientStaff.clientId, auth.client.clientId),
    orderBy: [asc(clientStaff.name)],
  });

  // Outlet names in one extra query (no relation, avoids a relation cycle)
  const outletIds = [...new Set(rows.map((m) => (m as any).outletId).filter(Boolean))] as string[];
  const outletRows =
    outletIds.length > 0
      ? await db.query.outlets.findMany({
          where: inArray(outlets.id, outletIds),
          columns: { id: true, name: true },
        })
      : [];
  const outletNames = new Map(outletRows.map((o) => [o.id, o.name]));

  return NextResponse.json({
    success: true,
    team: rows.map((m) => ({
      id: m.id,
      name: m.name,
      username: m.username,
      isActive: m.isActive,
      outletId: (m as any).outletId ?? null,
      outletName: outletNames.get((m as any).outletId) ?? null,
      createdAt: m.createdAt,
    })),
  });
}

export async function POST(request: Request) {
  try {
    const auth = await requireOwner(request);
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const result = createSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const { name, username, pin, outletId } = result.data;

    // Username must be globally unique across owners AND team staff
    // (single login field must resolve to exactly one account).
    const [ownerDup, staffDup] = await Promise.all([
      db.query.clients.findFirst({ where: eq(clients.username, username) }),
      db.query.clientStaff.findFirst({ where: eq(clientStaff.username, username) }),
    ]);
    if (ownerDup || staffDup) {
      return NextResponse.json({ error: "This user ID is already taken." }, { status: 409 });
    }

    // Outlet must belong to the same client (when given)
    if (outletId) {
      const outlet = await db.query.outlets.findFirst({ where: eq(outlets.id, outletId) });
      if (!outlet || outlet.clientId !== auth.client.clientId) {
        return NextResponse.json({ error: "Invalid outlet for this client." }, { status: 400 });
      }
    }

    const [created] = await db
      .insert(clientStaff)
      .values({
        clientId: auth.client.clientId,
        name: name.trim(),
        username,
        pinHash: await bcrypt.hash(pin, 10),
        outletId: outletId ?? null,
      })
      .returning({ id: clientStaff.id, name: clientStaff.name, username: clientStaff.username });

    return NextResponse.json(
      {
        success: true,
        message: `Team member "${created.name}" created with user ID "${created.username}". Share the PIN securely.`,
        member: created,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error in POST /api/client-team:", error);
    return NextResponse.json({ error: "Failed to add team member" }, { status: 500 });
  }
}
