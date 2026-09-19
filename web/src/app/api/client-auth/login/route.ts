import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { signClientToken } from "@/lib/jwt";
import { checkRateLimit } from "@/lib/rate-limiter";

const loginSchema = z.object({
  username: z.string().min(1, "User ID is required").max(100).trim(),
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

    const client = await db.query.clients.findFirst({
      where: eq(clients.username, normalized),
    });

    const hash = (client as { passwordHash?: string | null } | undefined)?.passwordHash;
    const ok = hash ? await bcrypt.compare(password, hash) : false;
    if (!client || !ok) {
      return NextResponse.json({ error: "Invalid user ID or password." }, { status: 401 });
    }

    const token = await signClientToken({
      id: client.id,
      username: (client as { username?: string | null }).username ?? normalized,
      phone: client.phone ?? null,
      email: client.email ?? null,
      name: client.name,
    });

    return NextResponse.json({
      success: true,
      message: "Login successful",
      token,
      client: {
        id: client.id,
        name: client.name,
        username: (client as { username?: string | null }).username ?? null,
        phone: client.phone ?? null,
        email: client.email ?? null,
      },
    });
  } catch (error: unknown) {
    console.error("Error in /api/client-auth/login:", error);
    return NextResponse.json({ error: "Internal server error during login" }, { status: 500 });
  }
}
