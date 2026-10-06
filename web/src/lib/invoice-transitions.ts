import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, auditLog, invoices, invoiceStatusLog } from "@/db/schema";
import { isTerminalStatus, isValidTransition, InvoiceStatus } from "@/lib/status-flow";
import { BadRequestError, ConflictError, ForbiddenError } from "@/lib/http-errors";
import { writeAudit } from "@/lib/audit";

/** Drizzle transaction handle (from db.transaction). */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TransitionActor = {
  type: "staff" | "client" | "client_staff" | "system";
  id: string | null;
  /** True when the staffer is an admin (maker-checker exemption gate). */
  isAdmin?: boolean;
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

  // Maker-checker (Phase 2.3, Step-3 hardened): verified -> collected
  // must be a DIFFERENT account than the one that set verified. The
  // verifier is the LATEST audit_log `invoice.status` entry for this
  // invoice whose after.status = 'verified' (a data-edit echo never
  // carries after.status, so edits can't move the checker). Legacy rows
  // with no such audit entry fall back to the earliest 'verified'
  // status_log row, and fail OPEN (with a console warning) if even that
  // is missing.
  // ENFORCE_MAKER_CHECKER=false disables; admins are exempt only with
  // ENFORCE_MAKER_CHECKER_ADMIN_EXEMPT=true.
  if (
    expectedStatus === "verified" &&
    nextStatus === "collected" &&
    (process.env.ENFORCE_MAKER_CHECKER ?? "true") !== "false"
  ) {
    const adminExempt =
      !!actor.isAdmin && (process.env.ENFORCE_MAKER_CHECKER_ADMIN_EXEMPT ?? "false") === "true";
    if (!adminExempt && actor.id) {
      const auditHits = await tx.query.auditLog.findMany({
        where: and(
          eq(auditLog.entityType, "invoice"),
          eq(auditLog.entityId, invoiceId),
          eq(auditLog.action, "invoice.status"),
          sql`${auditLog.after}->>'status' = 'verified'`
        ),
        orderBy: [desc(auditLog.at)],
        limit: 1,
        columns: { actorId: true },
      });
      const verifierId = auditHits[0]?.actorId ?? null;
      if (verifierId) {
        if (verifierId === actor.id) {
          throw new ForbiddenError(
            "Maker-checker: the account that verified this invoice cannot also collect it. Ask another staff member."
          );
        }
      } else {
        // Legacy fallback: earliest 'verified' status_log row.
        const legacy = await tx.query.invoiceStatusLog.findFirst({
          where: and(
            eq(invoiceStatusLog.invoiceId, invoiceId),
            eq(invoiceStatusLog.status, "verified" as any)
          ),
          orderBy: [asc(invoiceStatusLog.timestamp)],
          columns: { changedBy: true },
        });
        if (legacy?.changedBy && legacy.changedBy === actor.id) {
          throw new ForbiddenError(
            "Maker-checker: the account that verified this invoice cannot also collect it. Ask another staff member."
          );
        }
        if (!legacy?.changedBy) {
          console.warn(
            `maker-checker fail-open: no audit entry for invoice ${invoiceId} (legacy row)`
          );
        }
      }
    }
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
