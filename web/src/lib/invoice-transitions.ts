import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, invoices, invoiceStatusLog } from "@/db/schema";
import { isTerminalStatus, isValidTransition, InvoiceStatus } from "@/lib/status-flow";
import { BadRequestError, ConflictError } from "@/lib/http-errors";
import { writeAudit } from "@/lib/audit";

/** Drizzle transaction handle (from db.transaction). */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TransitionActor = {
  type: "staff" | "client" | "client_staff" | "system";
  id: string | null;
};

export type TransitionInput = {
  invoiceId: string;
  /** Status the caller read — the UPDATE only fires on this exact value. */
  expectedStatus: string;
  nextStatus: string;
  actor: TransitionActor;
  note?: string | null;
  /** Extra columns merged into the SET (e.g. priority, ocrData). */
  extraSet?: Record<string, unknown>;
  /** Convenience for reassignment (merged after extraSet). */
  assignedTo?: string | null;
  /**
   * Optimistic guard on the current assignee (assign route): undefined =
   * skip the check; null = must currently be unassigned (IS NULL).
   */
  expectedAssignedTo?: string | null;
  /** Optional assignments-row write (sweeps, assign route). */
  assignment?: { staffId: string; assignedBy: string };
  /**
   * Same-status "transition" gate: only callers that never take a `status`
   * from the request body (assign route, default-staff sweeps) may pass
   * true, and NEVER for terminal statuses. Anything else throws.
   */
  allowSameStatus?: boolean;
};

/**
 * THE single place that changes invoice status. Conditional update inside
 * the caller's transaction: zero rows returned means someone else moved
 * the row first → ConflictError (409), whole transaction rolls back.
 * Always writes the invoice_status_log row. changedBy is the staff/admin id;
 * client/system actors store null (existing convention).
 */
export async function transitionInvoice(tx: DbTx, input: TransitionInput) {
  const { invoiceId, expectedStatus, nextStatus, actor, note } = input;

  // Same-status "transition" (re-assignment keeping status) is allowed ONLY
  // when the caller explicitly opts in — and NEVER for terminal statuses.
  // Routes that accept a `status` field from the request body must never
  // set allowSameStatus (they always change status or 400 earlier).
  if (nextStatus === expectedStatus) {
    if (isTerminalStatus(expectedStatus as InvoiceStatus)) {
      throw new BadRequestError(
        `Invoice is in terminal state '${expectedStatus}'. No further updates or transitions are allowed.`
      );
    }
    if (!input.allowSameStatus) {
      throw new BadRequestError(
        `Illegal status transition from '${expectedStatus}' to '${nextStatus}'.`
      );
    }
  } else if (!isValidTransition(expectedStatus as InvoiceStatus, nextStatus as InvoiceStatus)) {
    throw new BadRequestError(
      `Illegal status transition from '${expectedStatus}' to '${nextStatus}'.`
    );
  }
  if (isTerminalStatus(expectedStatus as InvoiceStatus)) {
    throw new BadRequestError(
      `Invoice is in terminal state '${expectedStatus}'. No further updates or transitions are allowed.`
    );
  }

  const setClause: Record<string, unknown> = {
    status: nextStatus,
    updatedAt: new Date(),
    ...(input.extraSet ?? {}),
  };
  if (input.assignedTo !== undefined) {
    setClause.assignedTo = input.assignedTo;
  }

  const whereParts = [eq(invoices.id, invoiceId), eq(invoices.status, expectedStatus as any)];
  if (input.expectedAssignedTo !== undefined) {
    whereParts.push(
      input.expectedAssignedTo === null
        ? isNull(invoices.assignedTo)
        : eq(invoices.assignedTo, input.expectedAssignedTo)
    );
  }

  const [updated] = await tx
    .update(invoices)
    .set(setClause)
    .where(and(...whereParts))
    .returning();

  if (!updated) {
    throw new ConflictError("Invoice was modified by someone else. Refresh and retry.");
  }

  await tx.insert(invoiceStatusLog).values({
    invoiceId,
    status: nextStatus as any,
    changedBy: actor.type === "staff" && actor.id ? actor.id : null,
    note: note ?? null,
  });

  // Append-only audit (Phase 2.2): every status change, atomically.
  await writeAudit(tx, {
    actor: { type: actor.type, id: actor.id },
    action: "invoice.status",
    entityType: "invoice",
    entityId: invoiceId,
    before: { status: expectedStatus },
    after: {
      status: nextStatus,
      ...(input.assignedTo !== undefined ? { assignedTo: input.assignedTo } : {}),
    },
    meta: { note: note ?? null },
  });

  if (input.assignment) {
    await tx.insert(assignments).values({
      invoiceId,
      staffId: input.assignment.staffId,
      assignedBy: input.assignment.assignedBy,
    });
  }

  return updated;
}

/** Drop-in 409 message for data-only optimistic-lock failures. */
export function concurrentEditError(): ConflictError {
  return new ConflictError("Invoice was modified by someone else. Refresh and retry.");
}

/** Shared updated_at optimistic-lock predicate (data-only edits). Compares
 * at millisecond granularity: Postgres stores microseconds but JS Dates
 * truncate to ms, so exact equality would NEVER match DB-written rows. */
export function updatedAtMatches(updatedAt: Date | string) {
  const iso = updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
  return sql`date_trunc('milliseconds', ${invoices.updatedAt}) = date_trunc('milliseconds', ${iso}::timestamptz)`;
}
