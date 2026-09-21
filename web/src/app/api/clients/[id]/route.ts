import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { assignments, clients, invoices, invoiceStatusLog, staff } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isValidTransition } from "@/lib/status-flow";

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
  // Default staff for this client (all invoices route here). Null clears it.
  assignedStaffId: z.string().uuid("Invalid staff ID").nullable().optional(),
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

    const { name, username, password, phone, email, assignedStaffId } = result.data;

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
    if (assignedStaffId !== undefined) {
      if (assignedStaffId !== null) {
        const target = await db.query.staff.findFirst({ where: eq(staff.id, assignedStaffId) });
        if (!target || target.role !== "staff") {
          return NextResponse.json(
            { error: "Default staff must be an existing staff account." },
            { status: 400 }
          );
        }
      }
      (patch as any).assignedStaffId = assignedStaffId;
    }

    const [updated] = await db
      .update(clients)
      .set(patch)
      .where(eq(clients.id, id))
      .returning();

    // Backlog sweep: every unassigned ocr_done/ocr_failed invoice of this
    // client routes to the new default staff immediately (admin is the
    // assigner). Future uploads auto-route via the OCR worker.
    let swept = 0;
    if (assignedStaffId) {
      const backlog = await db.query.invoices.findMany({
        where: and(eq(invoices.clientId, id), isNull(invoices.assignedTo)),
      });
      for (const inv of backlog) {
        if (!isValidTransition(inv.status as any, "assigned")) continue;
        await db.transaction(async (tx) => {
          await tx
            .update(invoices)
            .set({ status: "assigned", assignedTo: assignedStaffId, updatedAt: new Date() })
            .where(eq(invoices.id, inv.id));
          await tx.insert(assignments).values({
            invoiceId: inv.id,
            staffId: assignedStaffId,
            assignedBy: (session.user as any).id,
          });
          await tx.insert(invoiceStatusLog).values({
            invoiceId: inv.id,
            status: "assigned",
            changedBy: (session.user as any).id,
            note: `Bulk-assigned via client default staff`,
          });
        });
        swept++;
      }
    }

    return NextResponse.json({
      success: true,
      message: password
        ? "Client credentials updated. Share the new password with the client."
        : assignedStaffId
          ? `Default staff set. ${swept} pending invoice(s) routed; future uploads auto-route.`
          : "Client updated.",
      client: {
        id: updated.id,
        name: updated.name,
        username: (updated as any).username ?? null,
        phone: (updated as any).phone ?? null,
        email: (updated as any).email ?? null,
      },
      swept,
    });
  } catch (error: any) {
    console.error("Error updating client:", error);
    return NextResponse.json({ error: "Failed to update client" }, { status: 500 });
  }
}
