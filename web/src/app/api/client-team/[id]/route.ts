import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientStaff } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";

const updateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  // Owner resets the PIN (member cannot do it themself)
  pin: z
    .string()
    .trim()
    .regex(/^\d{4,6}$/, "PIN must be 4-6 digits")
    .optional(),
  // Deactivation blocks login but preserves upload attribution
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (client.role !== "client") {
      return NextResponse.json({ error: "Only the client owner can manage the team." }, { status: 403 });
    }

    const { id } = await params;
    const member = await db.query.clientStaff.findFirst({ where: eq(clientStaff.id, id) });
    if (!member || member.clientId !== client.clientId) {
      return NextResponse.json({ error: "Team member not found." }, { status: 404 });
    }

    const body = await request.json();
    const result = updateSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const { name, pin, isActive } = result.data;
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name.trim();
    if (pin !== undefined) patch.pinHash = await bcrypt.hash(pin, 10);
    if (isActive !== undefined) patch.isActive = isActive;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const [updated] = await db
      .update(clientStaff)
      .set(patch)
      .where(eq(clientStaff.id, id))
      .returning({
        id: clientStaff.id,
        name: clientStaff.name,
        username: clientStaff.username,
        isActive: clientStaff.isActive,
      });

    return NextResponse.json({
      success: true,
      message: pin ? "PIN reset. Share the new PIN with the team member." : "Team member updated.",
      member: updated,
    });
  } catch (error: unknown) {
    console.error("Error in PATCH /api/client-team/[id]:", error);
    return NextResponse.json({ error: "Failed to update team member" }, { status: 500 });
  }
}
