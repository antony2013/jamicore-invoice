import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, clientStaff, invoices, outlets, staff } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { notDeleted } from "@/lib/invoice-access";
import { isValidTransition } from "@/lib/status-flow";
import { transitionInvoice } from "@/lib/invoice-transitions";
import { handleRouteError } from "@/lib/http-errors";
import { writeAudit, getClientIp } from "@/lib/audit";

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
  // Archive switch: archived clients cannot log in and their tokens die.
  // Unarchive restores login (a fresh password is still required if reset).
  archived: z.boolean().optional(),
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

    const { name, username, password, phone, email, assignedStaffId, archived } = result.data;

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
    // Archive/unarchive: blocks (or restores) login + kills live tokens.
    if (archived !== undefined) {
      (patch as any).archivedAt = archived ? new Date() : null;
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

    // ONE transaction for update + audits + sweep (all-or-nothing: if the
    // audit insert fails, the whole change rolls back).
    let swept = 0;
    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(clients)
        .set(patch)
        .where(eq(clients.id, id))
        .returning();

      // Audit the lifecycle changes (sweep rows audit themselves below).
      if (password !== undefined) {
        await writeAudit(tx, {
          actor: { type: "staff", id: me.id },
          action: "client.password_reset",
          entityType: "client",
          entityId: id,
          ip: getClientIp(request),
        });
      }
      if (archived !== undefined) {
        await writeAudit(tx, {
          actor: { type: "staff", id: me.id },
          action: archived ? "client.archive" : "client.unarchive",
          entityType: "client",
          entityId: id,
          ip: getClientIp(request),
        });
      }
      if (assignedStaffId !== undefined) {
        await writeAudit(tx, {
          actor: { type: "staff", id: me.id },
          action: "client.default_staff",
          entityType: "client",
          entityId: id,
          before: { assignedStaffId: (current as any).assignedStaffId ?? null },
          after: { assignedStaffId },
          ip: getClientIp(request),
        });
      }

      // Backlog sweep: every unassigned uploaded (or legacy OCR-processed)
      // invoice of this client routes to the new default staff immediately
      // (admin is the assigner). Future uploads auto-route at confirm time.
      // Each row goes through transitionInvoice so a concurrent move aborts
      // with 409 and rolls everything back.
      if (assignedStaffId) {
        const backlog = await tx.query.invoices.findMany({
          where: and(eq(invoices.clientId, id), isNull(invoices.assignedTo), notDeleted()),
          columns: { id: true, status: true },
        });
        for (const inv of backlog) {
          if (!isValidTransition(inv.status as any, "assigned")) continue;
          await transitionInvoice(tx, {
            invoiceId: inv.id,
            expectedStatus: inv.status,
            nextStatus: "assigned",
            actor: { type: "staff", id: me.id, isAdmin: true },
            note: `Bulk-assigned via client default staff`,
            assignedTo: assignedStaffId,
            expectedAssignedTo: null,
            allowSameStatus: true,
            assignment: { staffId: assignedStaffId, assignedBy: me.id },
          });
          swept++;
        }
      }
      return [row];
    });

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
    return handleRouteError(error, "PATCH /api/clients/[id]");
  }
}

/**
 * Remove a client — TWO-STEP, server-enforced:
 * Step 1: DELETE with no (or wrong) confirmUsername → 400 + counts of what
 * would be destroyed. Nothing is deleted.
 * Step 2: DELETE with { confirmUsername } matching the client's user ID
 * exactly:
 * - clients WITH invoices (including soft-deleted ones) → 409: archive
 *   instead (archive keeps history, blocks login, kills tokens).
 * - zero-invoice clients → hard delete: DB transaction FIRST (outlets +
 *   team cascade), S3 objects only AFTER commit, audit entry inside the tx.
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

    // ANY invoices — live or soft-deleted — block hard deletion.
    const invoiceCount = await db.query.invoices.findMany({
      where: eq(invoices.clientId, id),
      columns: { id: true },
    });
    const [clientOutlets, team] = await Promise.all([
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
      invoices: invoiceCount.length,
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

    if (counts.invoices > 0) {
      return NextResponse.json(
        {
          error: `This client has ${counts.invoices} invoice(s) (history is preserved even for withdrawn ones). Hard delete is blocked — archive the client instead.`,
          counts,
        },
        { status: 409 }
      );
    }

    // Zero-invoice hard delete: transaction first, S3 after commit.
    const doomedOutlets = clientOutlets.map((o) => o.id);
    await db.transaction(async (tx) => {
      await tx.delete(outlets).where(eq(outlets.clientId, id));
      // Team members cascade off the client row.
      await tx.delete(clients).where(eq(clients.id, id));
      await writeAudit(tx, {
        actor: { type: "staff", id: me.id },
        action: "client.hard_delete",
        entityType: "client",
        entityId: id,
        before: { name: (client as any).name, outlets: doomedOutlets.length, members: team.length },
        meta: { confirmToken },
      });
    });

    return NextResponse.json({
      success: true,
      message:
        `Client "${(client as any).name}" removed ` +
        `(${counts.outlets} outlet(s), ${counts.members} team member(s)). No invoices existed, so no files needed cleanup.`,
      deleted: counts,
      s3Failures: 0,
    });
  } catch (error: any) {
    return handleRouteError(error, "DELETE /api/clients/[id]");
  }
}
