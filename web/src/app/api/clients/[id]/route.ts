import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, clients, clientStaff, invoices, invoiceReports, invoiceStatusLog, outlets, staff } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { deleteObjectFromS3 } from "@/lib/s3";
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
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

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

    // Duplicate check for changed unique fields (usernames span owners + team)
    if (username && username !== (current as any).username) {
      const [dupOwner, dupStaff] = await Promise.all([
        db.query.clients.findFirst({ where: eq(clients.username, username) }),
        db.query.clientStaff.findFirst({ where: eq(clientStaff.username, username) }),
      ]);
      if (dupOwner || dupStaff) return NextResponse.json({ error: "This user ID is already taken." }, { status: 409 });
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
    if (password !== undefined) {
      (patch as any).passwordHash = await bcrypt.hash(password, 12);
      // Password reset kills the owner's other sessions.
      (patch as any).tokenVersion = sql`token_version + 1`;
    }
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

    // Backlog sweep: every unassigned uploaded (or legacy OCR-processed) invoice of this
    // client routes to the new default staff immediately (admin is the
    // assigner). Future uploads auto-route at confirm time.
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
            assignedBy: me.id,
          });
          await tx.insert(invoiceStatusLog).values({
            invoiceId: inv.id,
            status: "assigned",
            changedBy: me.id,
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

/**
 * Remove a client — TWO-STEP, server-enforced:
 * Step 1: DELETE with no (or wrong) confirmUsername → 400 + counts of what
 * would be destroyed. Nothing is deleted.
 * Step 2: DELETE with { confirmUsername } matching the client's user ID
 * exactly → full cascade: S3 objects (best-effort) + invoices (logs and
 * assignment history cascade) + outlets + team members + client.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

    const { id } = await params;
    const client = await db.query.clients.findFirst({ where: eq(clients.id, id) });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const [clientInvoices, clientOutlets, team] = await Promise.all([
      db.query.invoices.findMany({
        where: eq(invoices.clientId, id),
        columns: { id: true, s3Key: true },
      }),
      db.query.outlets.findMany({
        where: eq(outlets.clientId, id),
        columns: { id: true },
      }),
      db.query.clientStaff.findMany({
        where: eq(clientStaff.clientId, id),
        columns: { id: true },
      }),
    ]);
    const counts = {
      invoices: clientInvoices.length,
      outlets: clientOutlets.length,
      members: team.length,
    };

    const body = await request.json().catch(() => ({}));
    // Legacy OTP-era rows may have no username — then the client NAME is the
    // confirm token instead (the UI shows whichever one applies).
    const confirmToken = (client as any).username || (client as any).name;
    if (!confirmToken || body?.confirmUsername !== confirmToken) {
      return NextResponse.json(
        {
          error: "Confirmation required. Re-send with confirmUsername set to the client's user ID to permanently delete everything below.",
          counts,
        },
        { status: 400 }
      );
    }

    // S3 objects first (best-effort — a failure must not strand DB rows,
    // the key is reported back instead). Report files die with the invoice
    // rows (FK cascade) — collect their keys up front.
    let s3Failures = 0;
    const ids = clientInvoices.map((i) => i.id);
    const doomedReports =
      ids.length > 0
        ? await db.query.invoiceReports.findMany({
            where: inArray(invoiceReports.invoiceId, ids),
            columns: { s3Key: true },
          })
        : [];
    for (const inv of clientInvoices) {
      const ok = await deleteObjectFromS3((inv as any).s3Key);
      if (!ok) s3Failures++;
    }
    for (const rep of doomedReports) {
      const ok = await deleteObjectFromS3(rep.s3Key);
      if (!ok) s3Failures++;
    }

    await db.transaction(async (tx) => {
      // Assignment history + status logs cascade off the invoice rows.
      await tx.delete(invoices).where(eq(invoices.clientId, id));
      await tx.delete(outlets).where(eq(outlets.clientId, id));
      // Team members cascade off the client row.
      await tx.delete(clients).where(eq(clients.id, id));
    });

    return NextResponse.json({
      success: true,
      message:
        `Client "${(client as any).name}" removed ` +
        `(${counts.invoices} invoice(s), ${counts.outlets} outlet(s), ${counts.members} team member(s)).` +
        (s3Failures > 0 ? ` ${s3Failures} S3 object(s) could not be deleted — clean them manually.` : ""),
      deleted: counts,
      s3Failures,
    });
  } catch (error: any) {
    console.error("Error deleting client:", error);
    return NextResponse.json({ error: "Failed to delete client" }, { status: 500 });
  }
}
