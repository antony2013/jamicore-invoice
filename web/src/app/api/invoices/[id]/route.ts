import { NextResponse } from "next/server";
import { and, eq, desc, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { invoices, invoiceStatusLog, assignments, invoiceReports, outlets, staff } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { notDeleted } from "@/lib/invoice-access";
import { safeClient, safeClientStaff, safeStaff } from "@/lib/safe-columns";
import { isValidTransition, isTerminalStatus, InvoiceStatus } from "@/lib/status-flow";
import { concurrentEditError, transitionInvoice, updatedAtMatches } from "@/lib/invoice-transitions";
import { handleRouteError } from "@/lib/http-errors";
import { writeAudit } from "@/lib/audit";
import { categorySchema, validateCategory } from "@/lib/categories";
import { deleteObjectFromS3 } from "@/lib/s3";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;

    const { id } = await params;

    const invoice = await db.query.invoices.findFirst({
      where: and(eq(invoices.id, id), notDeleted()),
      with: {
        client: safeClient,
        assignedStaff: safeStaff,
        outlet: true,
        uploadedBy: safeClientStaff,
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Strict separation: staff see only invoices assigned to them.
    if (me.role !== "admin" && invoice.assignedTo !== me.id) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Fetch audit trail history
    const logs = await db.query.invoiceStatusLog.findMany({
      where: eq(invoiceStatusLog.invoiceId, id),
      with: {
        actor: safeStaff,
      },
      orderBy: [desc(invoiceStatusLog.timestamp)],
    });

    return NextResponse.json({
      success: true,
      invoice,
      statusLogs: logs,
    });
  } catch (error: any) {
    console.error("Error in GET /api/invoices/[id]:", error);
    return NextResponse.json({ error: "Failed to fetch invoice" }, { status: 500 });
  }
}

const updateInvoiceSchema = z.object({
  status: z.enum([
    "in_review",
    "needs_info",
    "verified",
    "collected",
    "disputed",
  ]).optional(),
  ocrData: z.object({
    amount: z.union([z.number(), z.string()]).optional().nullable(),
    invoiceNo: z.string().optional().nullable(),
    date: z.string().optional().nullable(),
    vendor: z.string().optional().nullable(),
    rawText: z.string().optional().nullable(),
  }).optional(),
  priority: z.enum(["low", "normal", "urgent"]).optional(),
  note: z.string().max(500).optional(),
  // Admin/staff may (re)assign the outlet; must belong to the invoice's client. Null clears it.
  outletId: z.string().uuid("Invalid outlet ID").nullable().optional(),
  // Category correction + custom text for Other
  category: categorySchema.optional(),
  categoryDetail: z.string().trim().max(200).nullable().optional(),
  // Optimistic-lock token: the updatedAt the editor loaded. Compared with
  // the row (409 on mismatch) instead of trusting only the in-request read.
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;

    const staffId = me.id;
    const { id } = await params;

    const body = await request.json();
    const result = updateInvoiceSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const currentInvoice = await db.query.invoices.findFirst({
      where: and(eq(invoices.id, id), notDeleted()),
    });

    if (!currentInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Strict separation: staff mutate only their own assigned invoices.
    const actorRole = me.role;
    if (actorRole !== "admin" && currentInvoice.assignedTo !== staffId) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Constraint: Check if already in terminal state
    if (isTerminalStatus(currentInvoice.status as InvoiceStatus)) {
      return NextResponse.json(
        {
          error: `Invoice is in terminal state '${currentInvoice.status}'. No further updates or transitions are allowed.`,
        },
        { status: 400 }
      );
    }

    const { status: nextStatus, ocrData, priority, note, outletId } = result.data;

    // Optimistic-lock token check: the editor's copy must match the row.
    if (result.data.expectedUpdatedAt !== undefined) {
      const expectedMs = new Date(result.data.expectedUpdatedAt).getTime();
      const currentMs = new Date(currentInvoice.updatedAt).getTime();
      if (expectedMs !== currentMs) {
        return NextResponse.json(
          { error: "Invoice was modified by someone else. Refresh and retry." },
          { status: 409 }
        );
      }
    }

    // Amount must be a real number — NaN/strings-that-aren't-numbers 400
    // instead of corrupting the row (z.number() accepts NaN).
    if (ocrData && ocrData.amount !== undefined && ocrData.amount !== null) {
      const n = typeof ocrData.amount === "number" ? ocrData.amount : Number(ocrData.amount);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: "Amount must be a valid number." }, { status: 400 });
      }
      ocrData.amount = n;
    }

    // Validate category + detail pair (Other requires custom text)
    const nextCategory = result.data.category ?? currentInvoice.category;
    const nextDetail =
      result.data.categoryDetail !== undefined
        ? result.data.categoryDetail
        : (currentInvoice as any).categoryDetail;
    const catError = validateCategory(nextCategory, nextDetail);
    if (catError) {
      return NextResponse.json({ error: catError }, { status: 400 });
    }

    // Validate status transition against the single centralized transition matrix
    // (enforced again inside transitionInvoice — the helper is authoritative).
    if (nextStatus && nextStatus !== currentInvoice.status) {
      const allowed = isValidTransition(currentInvoice.status as InvoiceStatus, nextStatus as InvoiceStatus);
      if (!allowed) {
        return NextResponse.json(
          {
            error: `Illegal status transition from '${currentInvoice.status}' to '${nextStatus}'.`,
          },
          { status: 400 }
        );
      }
    }

    // Validate outlet belongs to the invoice's client (or null to clear)
    if (outletId !== undefined && outletId !== null) {
      const outlet = await db.query.outlets.findFirst({
        where: eq(outlets.id, outletId),
      });
      if (!outlet || outlet.clientId !== currentInvoice.clientId) {
        return NextResponse.json(
          { error: "Outlet does not belong to this invoice's client." },
          { status: 400 }
        );
      }
    }

    // Data fields accompanying the PATCH (status changes go through the
    // helper below; data-only edits use the optimistic lock). before/after
    // snapshots feed the audit entry — changed fields only.
    const dataSet: Record<string, unknown> = {};
    if (priority) dataSet.priority = priority;
    if (outletId !== undefined) dataSet.outletId = outletId;
    if (result.data.category !== undefined) {
      dataSet.category = nextCategory;
      dataSet.categoryDetail =
        nextCategory === "other" ? (nextDetail as string).trim() : null;
    } else if (result.data.categoryDetail !== undefined && currentInvoice.category === "other") {
      dataSet.categoryDetail = result.data.categoryDetail?.trim() || null;
    }
    if (ocrData) {
      dataSet.ocrData = {
        ...currentInvoice.ocrData,
        ...ocrData,
      };
    }
    const dataBefore: Record<string, unknown> = {};
    for (const k of Object.keys(dataSet)) {
      dataBefore[k] = (currentInvoice as any)[k] ?? null;
    }

    const updated = await db.transaction(async (tx) => {
      // Status change → the single race-safe helper (conditional update +
      // log row inside this transaction).
      if (nextStatus && nextStatus !== currentInvoice.status) {
        const row = await transitionInvoice(tx, {
          invoiceId: id,
          expectedStatus: currentInvoice.status,
          nextStatus,
          actor: { type: "staff", id: staffId },
          note: note || `Status updated from ${currentInvoice.status} to ${nextStatus}`,
          extraSet: dataSet,
        });
        if (Object.keys(dataSet).length > 0) {
          await writeAudit(tx, {
            actor: { type: "staff", id: staffId },
            action: "invoice.edit",
            entityType: "invoice",
            entityId: id,
            before: dataBefore,
            after: dataSet,
            meta: { note: note ?? null },
          });
        }
        return row;
      }

      // Data-only edit → optimistic lock on status + updatedAt so two
      // editors cannot silently overwrite each other.
      const updatePayload: any = {
        updatedAt: new Date(),
        ...dataSet,
      };

      const [res] = await tx
        .update(invoices)
        .set(updatePayload)
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.status, currentInvoice.status as any),
            updatedAtMatches(currentInvoice.updatedAt)
          )
        )
        .returning();

      if (!res) {
        throw concurrentEditError();
      }

      // Data-only edits log only when an explicit note is provided
      // (avoids timeline spam on every save).
      if (note) {
        await tx.insert(invoiceStatusLog).values({
          invoiceId: id,
          status: currentInvoice.status,
          changedBy: staffId,
          note,
        });
      }

      // Audit entry for data edits — always (independent of the note).
      if (Object.keys(dataSet).length > 0) {
        await writeAudit(tx, {
          actor: { type: "staff", id: staffId },
          action: "invoice.edit",
          entityType: "invoice",
          entityId: id,
          before: dataBefore,
          after: dataSet,
          meta: { note: note ?? null },
        });
      }

      return res;
    });

    return NextResponse.json({
      success: true,
      invoice: updated,
    });
  } catch (error: any) {
    return handleRouteError(error, "PATCH /api/invoices/[id]");
  }
}

const TERMINAL_DELETE_BLOCKED = ["collected", "disputed"] as const;
const STAFF_DELETABLE = ["assigned", "in_review", "needs_info"] as const;

/**
 * Office SOFT delete: sets deleted_at/by/reason and hides the row from every
 * list/detail/stat/export. Status logs, assignments, messages, reports and
 * the S3 objects are KEPT (purge only via the db:purge script).
 * - Admin: anything EXCEPT terminal collected/disputed (money trail stays).
 * - Staff: only own assigned invoices in pre-verification states
 *   (assigned/in_review/needs_info). Verified+ is an office decision.
 * Requires a `reason` (min 5 chars). Permission rules unchanged.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;

    const role = me.role;
    const actorId = me.id;
    const { id } = await params;

    const current = await db.query.invoices.findFirst({
      where: and(eq(invoices.id, id), notDeleted()),
    });
    if (!current) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if ((TERMINAL_DELETE_BLOCKED as readonly string[]).includes(current.status)) {
      return NextResponse.json(
        { error: `Invoices in terminal state '${current.status}' cannot be deleted (audit trail).` },
        { status: 400 }
      );
    }

    if (role !== "admin") {
      if (current.assignedTo !== actorId) {
        return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      }
      if (!(STAFF_DELETABLE as readonly string[]).includes(current.status)) {
        return NextResponse.json(
          { error: `Status '${current.status}' can only be deleted by an admin.` },
          { status: 403 }
        );
      }
    }

    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 5) {
      return NextResponse.json(
        { error: "A reason of at least 5 characters is required to delete an invoice." },
        { status: 400 }
      );
    }

    await db.transaction(async (tx) => {
      const [soft] = await tx
        .update(invoices)
        .set({
          deletedAt: new Date(),
          deletedBy: `${role}:${actorId}`,
          deleteReason: reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.status, current.status as any),
            isNull(invoices.deletedAt)
          )
        )
        .returning({ id: invoices.id });
      if (!soft) {
        throw concurrentEditError();
      }
      await writeAudit(tx, {
        actor: { type: "staff", id: actorId },
        action: "invoice.soft_delete",
        entityType: "invoice",
        entityId: id,
        before: { status: current.status },
        after: { deleted: true },
        meta: { reason, role },
      });
    });

    console.log(`Invoice ${id} soft-deleted by ${role} ${actorId} (reason: ${reason})`);

    return NextResponse.json({
      success: true,
      message: "Invoice deleted. Its history, files and reports are retained.",
    });
  } catch (error: any) {
    return handleRouteError(error, "DELETE /api/invoices/[id]");
  }
}
