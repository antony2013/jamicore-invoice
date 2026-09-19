import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { auth } from "@/lib/auth";

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+\d{7,15}$/, "Phone must be E.164 format, e.g. +18765550123");

const updateClientSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9._-]+$/, "User ID may contain letters, numbers, dots, underscores and hyphens")
    .optional(),
  // Admin password reset: set a new login password for the client
  password: z.string().min(8, "Password must be at least 8 characters").max(128).optional(),
  phone: phoneSchema.nullable().optional(),
  email: z.string().email("Invalid email address").toLowerCase().trim().nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const result = updateClientSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const current = await db.query.clients.findFirst({ where: eq(clients.id, id) });
    if (!current) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const { name, username, password, phone, email } = result.data;

    // Duplicate check for changed unique fields
    if (username && username !== (current as any).username) {
      const dup = await db.query.clients.findFirst({ where: eq(clients.username, username) });
      if (dup) return NextResponse.json({ error: "This user ID is already taken." }, { status: 409 });
    }
    if (phone && phone !== (current as any).phone) {
      const dup = await db.query.clients.findFirst({ where: eq(clients.phone, phone) });
      if (dup) return NextResponse.json({ error: "This phone number is already in use." }, { status: 409 });
    }
    if (email && email !== (current as any).email) {
      const dup = await db.query.clients.findFirst({ where: eq(clients.email, email) });
      if (dup) return NextResponse.json({ error: "This email is already in use." }, { status: 409 });
    }

    const patch: Partial<typeof clients.$inferInsert> = {};
    if (name !== undefined) patch.name = name.trim();
    if (username !== undefined) (patch as any).username = username;
    if (password !== undefined) (patch as any).passwordHash = await bcrypt.hash(password, 10);
    if (phone !== undefined) (patch as any).phone = phone;
    if (email !== undefined) (patch as any).email = email;

    const [updated] = await db
      .update(clients)
      .set(patch)
      .where(eq(clients.id, id))
      .returning();

    return NextResponse.json({
      success: true,
      message: password ? "Client credentials updated. Share the new password with the client." : "Client updated.",
      client: {
        id: updated.id,
        name: updated.name,
        username: (updated as any).username ?? null,
        phone: (updated as any).phone ?? null,
        email: (updated as any).email ?? null,
      },
    });
  } catch (error: any) {
    console.error("Error updating client:", error);
    return NextResponse.json({ error: "Failed to update client" }, { status: 500 });
  }
}
