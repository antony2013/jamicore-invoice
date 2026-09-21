import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, clientStaff } from "@/db/schema";
import { signClientToken } from "@/lib/jwt";
import { checkRateLimit } from "@/lib/rate-limiter";

const loginSchema = z.object({
  // User ID (client owner username OR team staff username)
  username: z.string().min(1, "User ID is required").max(100).trim(),
  // Password (owner) OR PIN (team staff, 4-6 digits) — tried in that order
  password: z.string().min(1, "Password is required").max(128),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = loginSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const { username, password } = result.data;
    const normalized = username.toLowerCase();

    // Brute-force guard per user ID (generic error below avoids user enumeration)
    const rl = checkRateLimit(`client-login:${normalized}`, 10, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: "Too many login attempts. Please try again later.",
          resetTime: new Date(rl.resetTime).toISOString(),
        },
        { status: 429 }
      );
    }

    // 1. Client owner: username + bcrypt password
    const owner = await db.query.clients.findFirst({
      where: eq(clients.username, normalized),
    });
    const ownerHash = (owner as { passwordHash?: string | null } | undefined)?.passwordHash;
    if (owner && ownerHash && (await bcrypt.compare(password, ownerHash))) {
      const token = await signClientToken({
        id: owner.id,
        role: "client",
        clientId: owner.id,
        username: (owner as { username?: string | null }).username ?? normalized,
        phone: owner.phone ?? null,
        email: owner.email ?? null,
        name: owner.name,
      });
      return NextResponse.json({
        success: true,
        message: "Login successful",
        token,
        client: {
          id: owner.id,
          name: owner.name,
          username: (owner as { username?: string | null }).username ?? null,
          role: "client",
          clientId: owner.id,
          phone: owner.phone ?? null,
          email: owner.email ?? null,
        },
      });
    }

    // 2. Team staff: username + bcrypt PIN (active accounts only)
    const member = await db.query.clientStaff.findFirst({
      where: eq(clientStaff.username, normalized),
    });
    if (member && member.isActive && (await bcrypt.compare(password, member.pinHash))) {
      const home = await db.query.clients.findFirst({ where: eq(clients.id, member.clientId) });
      const token = await signClientToken({
        id: member.id,
        role: "client_staff",
        clientId: member.clientId,
        username: member.username,
        name: member.name,
        staffName: member.name,
      });
      return NextResponse.json({
        success: true,
        message: "Login successful",
        token,
        client: {
          id: member.id,
          name: member.name,
          username: member.username,
          role: "client_staff",
          clientId: member.clientId,
          clientName: home?.name ?? null,
          phone: null,
          email: null,
        },
      });
    }

    return NextResponse.json({ error: "Invalid user ID or password." }, { status: 401 });
  } catch (error: unknown) {
    console.error("Error in /api/client-auth/login:", error);
    return NextResponse.json({ error: "Internal server error during login" }, { status: 500 });
  }
}
