import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { auth } from "@/lib/auth";

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+\d{7,15}$/, "Phone must be E.164 format, e.g. +18765550123");

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "User ID must be at least 3 characters")
  .max(50)
  .regex(/^[a-z0-9._-]+$/, "User ID may contain letters, numbers, dots, underscores and hyphens");

const createClientSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters").max(100),
    username: usernameSchema,
    password: z.string().min(8, "Password must be at least 8 characters").max(128),
    phone: phoneSchema.optional(),
    email: z.string().email("Invalid email address").toLowerCase().trim().optional(),
  })
  .refine((d) => d.phone || d.email, {
    message: "Either phone (E.164) or email is required",
  });

function toPublicClient(c: typeof clients.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    username: (c as { username?: string | null }).username ?? null,
    phone: (c as { phone?: string | null }).phone ?? null,
    email: (c as { email?: string | null }).email ?? null,
    createdAt: c.createdAt,
  };
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    const clientList = await db.query.clients.findMany({
      with: {
        invoices: true,
      },
      orderBy: [desc(clients.createdAt)],
    });

    const formatted = clientList.map((c) => ({
      ...toPublicClient(c),
      totalInvoices: c.invoices.length,
    }));

    return NextResponse.json({
      success: true,
      clients: formatted,
    });
  } catch (error: any) {
    console.error("Error fetching clients:", error);
    return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    const body = await request.json();
    const result = createClientSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const { name, username, password, phone, email } = result.data;

    // Duplicate check on username, phone and/or email
    const dupConditions = [eq(clients.username, username)];
    if (phone) dupConditions.push(eq(clients.phone, phone));
    if (email) dupConditions.push(eq(clients.email, email));
    const existing = await db.query.clients.findFirst({
      where: or(...dupConditions),
    });
    if (existing) {
      return NextResponse.json(
        { error: "A client with this user ID, phone number or email already exists." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [created] = await db
      .insert(clients)
      .values({
        name: name.trim(),
        username,
        passwordHash,
        phone: phone ?? null,
        email: email ?? null,
      })
      .returning();

    return NextResponse.json(
      {
        success: true,
        message: `Client "${created.name}" created with user ID "${username}". Share these credentials with the client.`,
        client: toPublicClient(created),
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Error creating client:", error);
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
  }
}
