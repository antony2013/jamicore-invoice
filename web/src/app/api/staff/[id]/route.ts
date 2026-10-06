import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, staff } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { OPEN_INVOICE_STATUSES } from "@/lib/invoice-access";

const updateStaffSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100).optional(),
  // Admin password reset: set a new login password for the staff member
  password: z.string().min(8, "Password must be at least 8 characters").max(128).optional(),
  // Lifecycle: deactivation blocks login + kills sessions (token_version bump)
  isActive: z.boolean().optional(),
  // Role change: staff <-> admin (demotions guarded below)
  role: z.enum(["admin", "staff"]).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

    const { id } = await params;
    const row = await db.query.staff.findFirst({ where: eq(staff.id, id) });
    if (!row) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }
    const openInvoices = await db.query.invoices.findMany({
      where: and(
        eq(invoices.assignedTo, id),
        inArray(invoices.status, [...OPEN_INVOICE_STATUSES] as any)
      ),
      columns: { id: true },
    });
    return NextResponse.json({
      success: true,
      staff: {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        isActive: (row as { isActive?: boolean }).isActive ?? true,
      },
      openInvoiceCount: openInvoices.length,
    });
  } catch (error: any) {
    console.error("Error fetching staff member:", error);
    return NextResponse.json({ error: "Failed to fetch staff member" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

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

    const { name, password, isActive, role } = result.data;
    const nextActive = isActive ?? current.isActive;
    const nextRole = role ?? current.role;

    // Guard 1: nobody deactivates or demotes themselves.
    if (id === me.id && (nextActive === false || nextRole !== "admin")) {
      return NextResponse.json(
        { error: "You cannot deactivate or demote your own account." },
        { status: 400 }
      );
    }

    // Guard 2: the last active admin stays (deactivation or demotion).
    if (nextActive === false || nextRole !== current.role) {
      const otherAdmins = await db.query.staff.findMany({
        where: and(eq(staff.role, "admin"), eq(staff.isActive, true)),
        columns: { id: true },
      });
      const remaining = otherAdmins.filter((a) => a.id !== id);
      if (remaining.length === 0 && current.role === "admin" && current.isActive) {
        return NextResponse.json(
          { error: "This is the last active admin — it cannot be deactivated or demoted." },
          { status: 400 }
        );
      }
    }

    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name.trim();
    if (password !== undefined) patch.passwordHash = await bcrypt.hash(password, 12);
    if (isActive !== undefined) patch.isActive = isActive;
    if (role !== undefined) patch.role = role;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    // Password reset, deactivation/reactivation and role change all revoke
    // live sessions (JWT revalidation compares token_version).
    if (password !== undefined || isActive !== undefined || role !== undefined) {
      patch.tokenVersion = sql`token_version + 1`;
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
        isActive: staff.isActive,
      });

    // Open work currently sitting with this person (caller decides reassign).
    const openInvoices = await db.query.invoices.findMany({
      where: and(
        eq(invoices.assignedTo, id),
        inArray(invoices.status, [...OPEN_INVOICE_STATUSES] as any)
      ),
      columns: { id: true },
    });

    const bits: string[] = [];
    if (password !== undefined) bits.push("Password reset — share the new password, old sessions revoked.");
    if (isActive !== undefined) bits.push(isActive ? "Account reactivated." : "Account deactivated — login blocked, sessions revoked.");
    if (role !== undefined && role !== current.role) bits.push(`Role changed to ${role}.`);
    if (name !== undefined) bits.push("Name updated.");

    return NextResponse.json({
      success: true,
      message: bits.length > 0 ? bits.join(" ") : "Staff member updated.",
      staff: updated,
      openInvoiceCount: openInvoices.length,
    });
  } catch (error: any) {
    console.error("Error updating staff:", error);
    return NextResponse.json({ error: "Failed to update staff member" }, { status: 500 });
  }
}
