import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";
import { checkRateLimit } from "@/lib/rate-limiter";

const schema = z.object({
  oldPassword: z.string().min(1, "Current password is required").max(128),
  newPassword: z.string().min(8, "New password must be at least 8 characters").max(128),
});

/**
 * Client changes their OWN login password (mobile Account screen).
 * Identity strictly from JWT. Rate-limited + generic errors throughout.
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

    const rl = checkRateLimit(`client-pw:${client.sub}`, 10, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: "Too many attempts. Please try again later.",
          resetTime: new Date(rl.resetTime).toISOString(),
        },
        { status: 429 }
      );
    }

    const body = await request.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const row = await db.query.clients.findFirst({ where: eq(clients.id, client.sub) });
    const hash = (row as { passwordHash?: string | null } | undefined)?.passwordHash;
    if (!row || !hash || !(await bcrypt.compare(result.data.oldPassword, hash))) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }

    await db
      .update(clients)
      .set({ passwordHash: await bcrypt.hash(result.data.newPassword, 10) })
      .where(eq(clients.id, client.sub));

    return NextResponse.json({ success: true, message: "Password changed successfully." });
  } catch (error: unknown) {
    console.error("Error in POST /api/client-auth/change-password:", error);
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
