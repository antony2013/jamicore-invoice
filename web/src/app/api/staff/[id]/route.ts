import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { auth } from "@/lib/auth";

const updateStaffSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100).optional(),
  // Admin password reset: set a new login password for the staff member
  password: z.string().min(8, "Password must be at least 8 characters").max(128).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as unknown as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const result = updateStaffSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const current = await db.query.staff.findFirst({ where: eq(staff.id, id) });
    if (!current) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }

    const { name, password } = result.data;
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name.trim();
    if (password !== undefined) patch.passwordHash = await bcrypt.hash(password, 10);
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const [updated] = await db
      .update(staff)
      .set(patch)
      .where(eq(staff.id, id))
      .returning({
        id: staff.id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
      });

    return NextResponse.json({
      success: true,
      message: password
        ? "Password reset. Share the new password with the staff member."
        : "Staff member updated.",
      staff: updated,
    });
  } catch (error: any) {
    console.error("Error updating staff:", error);
    return NextResponse.json({ error: "Failed to update staff member" }, { status: 500 });
  }
}
