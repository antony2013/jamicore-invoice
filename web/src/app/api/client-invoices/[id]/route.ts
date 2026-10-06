import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { assignments, invoices, invoiceStatusLog, outlets } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";
import { categorySchema, validateCategory } from "@/lib/categories";
import { hasManualAssignment, isClientEditable, DELETE_WINDOW_MS } from "@/lib/client-edit-rules";
import { concurrentEditError, updatedAtMatches } from "@/lib/invoice-transitions";
import { ConflictError, handleRouteError, NotFoundError } from "@/lib/http-errors";
import { clientInvoiceOr404 } from "@/lib/invoice-access";
import { writeAudit } from "@/lib/audit";

/**
 * Client self-service on their OWN invoice.
 * Editable only BEFORE staff takes ownership: uploaded, ocr_pending,
 * ocr_done, ocr_failed. Once assigned (or beyond), the office owns the
 * record — client edits/deletes are rejected with 409.
 * Team staff are further scoped to rows THEY uploaded: one member can never
 * touch another member's uploads (owner sees/edits everything).
 * Edit/withdraw eligibility lives in lib/client-edit-rules.ts (shared).
 */

const updateSchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
  pageNotes: z.array(z.string().trim().max(500)).max(20).optional(),
  outletId: z.string().uuid("Invalid outlet ID").nullable().optional(),
  category: categorySchema.optional(),
  categoryDetail: z.string().trim().max(200).nullable().optional(),
  // Optimistic-lock token: the updatedAt the editor loaded (409 on mismatch).
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

async function ownInvoiceOr404(
  invoiceId: string,
  client: { clientId: string; role: string; sub: string }
) {
  // Shared helper: own-client scope + team-staff own-uploads rule +
  // soft-deleted rows read as 404.
  return clientInvoiceOr404(invoiceId, client);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json(
        { error: "Unauthorized. Valid client Bearer token is required." },
        { status: 401 }
      );
    }

    const { id } = await params;
    const found = await ownInvoiceOr404(id, client);
    if ("error" in found) return found.error;
    const current = found.invoice;

    // Editable pre-assignment, plus auto-assigned-but-untouched rows
    // (shared rule — see lib/client-edit-rules.ts).
    if (!isClientEditable(current.status, await hasManualAssignment(id))) {
      return NextResponse.json(
        { error: `Invoice is already with the office (status '${current.status}'). Contact them to make changes.` },
        { status: 409 }
      );
    }

    const body = await request.json();
    const result = updateSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    // Optimistic-lock token check against the row (not just the in-request
    // read the conditional UPDATE below also guards).
    if (result.data.expectedUpdatedAt !== undefined) {
      const expectedMs = new Date(result.data.expectedUpdatedAt).getTime();
      const currentMs = new Date(current.updatedAt).getTime();
      if (expectedMs !== currentMs) {
        return NextResponse.json(
          { error: "Invoice was modified by someone else. Refresh and retry." },
          { status: 409 }
        );
      }
    }

    const { note, pageNotes, outletId } = result.data;
    if (outletId !== undefined && outletId !== null) {
      const outlet = await db.query.outlets.findFirst({ where: eq(outlets.id, outletId) });
      if (!outlet || outlet.clientId !== client.clientId) {
        return NextResponse.json({ error: "Invalid outlet for this client." }, { status: 400 });
      }
    }

    // Validate category + detail against the CURRENT row when partially sent
    const nextCategory = result.data.category ?? current.category;
    const nextDetail =
      result.data.categoryDetail !== undefined
        ? result.data.categoryDetail
        : (current as any).categoryDetail;
    const catError = validateCategory(nextCategory, nextDetail);
    if (catError) {
      return NextResponse.json({ error: catError }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (note !== undefined) patch.clientNote = note && note.length > 0 ? note : null;
    if (pageNotes !== undefined) {
      patch.pageNotes = pageNotes.some((n) => n.length > 0) ? pageNotes : null;
    }
    if (outletId !== undefined) patch.outletId = outletId;
    if (result.data.category !== undefined) {
      patch.category = nextCategory;
      patch.categoryDetail = nextCategory === "other" ? (nextDetail as string).trim() : null;
    } else if (result.data.categoryDetail !== undefined && current.category === "other") {
      patch.categoryDetail = result.data.categoryDetail?.trim() || null;
    }

    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const [updated] = await db.transaction(async (tx) => {
      // Optimistic lock: the office may have touched the row after our
      // read — status or updatedAt drift aborts with 409, not a silent
      // overwrite. (Client edits never change status themselves.)
      const [row] = await tx
        .update(invoices)
        .set(patch)
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.status, current.status as any),
            updatedAtMatches(current.updatedAt)
          )
        )
        .returning();
      if (!row) {
        throw concurrentEditError();
      }
      await tx.insert(invoiceStatusLog).values({
        invoiceId: id,
        status: row.status,
        changedBy: null,
        note: "Client updated invoice details",
      });
      // Audit entry — changed fields only (clientNote, not raw `note`).
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const k of ["clientNote", "pageNotes", "outletId", "category", "categoryDetail"] as const) {
        if (k in patch) {
          before[k] = (current as any)[k] ?? null;
          after[k] = (patch as any)[k];
        }
      }
      await writeAudit(tx, {
        actor: {
          type: client.role === "client_staff" ? "client_staff" : "client",
          id: client.sub,
        },
        action: "invoice.edit",
        entityType: "invoice",
        entityId: id,
        before,
        after,
      });
      return [row];
    });

    return NextResponse.json({ success: true, invoice: updated });
  } catch (error: unknown) {
    return handleRouteError(error, "PATCH /api/client-invoices/[id]");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json(
        { error: "Unauthorized. Valid client Bearer token is required." },
        { status: 401 }
      );
    }

    const { id } = await params;
    const found = await ownInvoiceOr404(id, client);
    if ("error" in found) return found.error;
    const current = found.invoice;

    // Shared rule: pre-assignment always; `assigned` only when auto-assigned
    // and untouched (no admin hand). Then the 1-hour upload window.
    const manual = await hasManualAssignment(id);
    if (!isClientEditable(current.status, manual)) {
      return NextResponse.json(
        { error: `Invoice is already with the office (status '${current.status}') and cannot be withdrawn.` },
        { status: 409 }
      );
    }

    // 1-hour withdrawal window from upload time. After that the record is
    // locked for the office — even if still unassigned (prevents silent
    // late deletions).
    const ageMs = Date.now() - new Date(current.createdAt).getTime();
    if (ageMs > DELETE_WINDOW_MS) {
      return NextResponse.json(
        { error: "Withdrawal window expired (1 hour after upload). Contact the office to remove this invoice." },
        { status: 403 }
      );
    }

    // Soft withdraw: the row stays (history, thread, office visibility)
    // with deleted_at set; the file stays in S3 (purge is office-side).
    // The status + manual-assignment checks are REPEATED inside the tx: if
    // the office touched the row between our read and this write, the
    // withdraw aborts instead of hiding an invoice under active review.
    const WITHDRAW_REASON = "Withdrawn by client";
    await db.transaction(async (tx) => {
      const fresh = await tx.query.invoices.findFirst({
        where: eq(invoices.id, id),
        columns: { id: true, status: true, deletedAt: true },
      });
      if (!fresh || fresh.deletedAt) {
        throw new NotFoundError("Invoice no longer exists.");
      }
      const freshManual = await tx.query.assignments.findFirst({
        where: eq(assignments.invoiceId, id),
        columns: { id: true },
      });
      if (!isClientEditable(fresh.status, !!freshManual)) {
        throw new ConflictError(
          `Invoice moved to '${fresh.status}' while withdrawing — the office now owns it. Contact them to remove it.`
        );
      }
      const [soft] = await tx
        .update(invoices)
        .set({
          deletedAt: new Date(),
          deletedBy: `client:${client.sub}`,
          deleteReason: WITHDRAW_REASON,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.status, fresh.status as any),
            isNull(invoices.deletedAt)
          )
        )
        .returning({ id: invoices.id });
      if (!soft) {
        throw concurrentEditError();
      }
      await writeAudit(tx, {
        actor: {
          type: client.role === "client_staff" ? "client_staff" : "client",
          id: client.sub,
        },
        action: "invoice.soft_delete",
        entityType: "invoice",
        entityId: id,
        before: { status: fresh.status },
        after: { deleted: true },
        meta: { reason: WITHDRAW_REASON },
      });
    });

    return NextResponse.json({
      success: true,
      message: "Invoice withdrawn. It is hidden from your history but retained by the office.",
    });
  } catch (error: unknown) {
    // Transaction-thrown user messages (e.g. office touched the row mid-
    // withdraw) keep their 409 via handleRouteError — never a bare 500.
    return handleRouteError(error, "DELETE /api/client-invoices/[id]");
  }
}
