import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { auth } from "@/lib/auth";
import { touchPresence } from "@/lib/presence";

const createStaffSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Invalid email address").toLowerCase().trim(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  role: z.enum(["admin", "staff"]).default("staff"),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || (session.user as unknown as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }
    touchPresence((session.user as unknown as { id?: string }).id);

    const staffList = await db.query.staff.findMany({
      columns: {
        id: true,
        name: true,
        email: true,
        role: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      staff: staffList,
    });
  } catch (error: any) {
    console.error("Error fetching staff list:", error);
    return NextResponse.json({ error: "Failed to fetch staff list" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as unknown as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 });
    }

    const body = await request.json();
    const result = createStaffSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const { name, email, password, role } = result.data;

    const existing = await db.query.staff.findFirst({ where: eq(staff.email, email) });
    if (existing) {
      return NextResponse.json(
        { error: "A staff member with this email already exists." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [created] = await db
      .insert(staff)
      .values({ name: name.trim(), email, role, passwordHash })
      .returning({
        id: staff.id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        createdAt: staff.createdAt,
      });

    return NextResponse.json(
      {
        success: true,
        message: `${role === "admin" ? "Admin" : "Staff member"} created successfully.`,
        staff: created,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Error creating staff:", error);
    return NextResponse.json({ error: "Failed to create staff member" }, { status: 500 });
  }
}
