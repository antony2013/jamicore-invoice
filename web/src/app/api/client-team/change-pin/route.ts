import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientStaff } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";
import { checkRateLimit } from "@/lib/rate-limiter";

/**
 * Team staff change their OWN PIN (knowing the old one).
 * Owner resets are done via PATCH /api/client-team/[id].
 */
export async function POST(request: Request) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (client.role !== "client_staff") {
      return NextResponse.json({ error: "Only team members can use this endpoint." }, { status: 403 });
    }

    const rl = checkRateLimit(`client-pw:${client.sub}`, 10, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    }

    const body = await request.json();
    const result = z
      .object({
        oldPin: z.string().min(1).max(128),
        newPin: z.string().trim().regex(/^\d{4,6}$/, "New PIN must be 4-6 digits"),
      })
      .safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const row = await db.query.clientStaff.findFirst({ where: eq(clientStaff.id, client.sub) });
    if (!row || !row.isActive || !(await bcrypt.compare(result.data.oldPin, row.pinHash))) {
      return NextResponse.json({ error: "Current PIN is incorrect." }, { status: 401 });
    }

    await db
      .update(clientStaff)
      .set({ pinHash: await bcrypt.hash(result.data.newPin, 10) })
      .where(eq(clientStaff.id, client.sub));

    return NextResponse.json({ success: true, message: "PIN changed successfully." });
  } catch (error: unknown) {
    console.error("Error in POST /api/client-team/change-pin:", error);
    return NextResponse.json({ error: "Failed to change PIN" }, { status: 500 });
  }
}
