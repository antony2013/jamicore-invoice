import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";

/** Invoices that still need a human (open work). */
export const OPEN_INVOICE_STATUSES = ["assigned", "in_review", "needs_info"] as const;

/**
 * Shared soft-delete exclusion for EVERY invoice query (Phase 2.2).
 * Soft-deleted rows vanish from lists/detail/stats/exports but keep their
 * logs, messages, reports and S3 objects.
 */
export function notDeleted() {
  return isNull(invoices.deletedAt);
}

/** Raw-SQL twin for db.execute queries (staff stats). */
export function notDeletedSql() {
  return sql`"invoices"."deleted_at" IS NULL`;
}

/**
 * Statuses an UNCLAIMED invoice can be in. Uploads land as `uploaded`; the
 * ocr_* values are legacy rows still draining. Anything verified or later is
 * always owned by a staffer, so an unclaimed row in those states stays
 * admin-only.
 */
export const UNCLAIMED_STATUSES = [
  "uploaded",
  "ocr_pending",
  "ocr_done",
  "ocr_failed",
  "assigned",
] as const;

/**
 * Staff queue visibility: unclaimed invoices waiting to be taken are shared
 * by every staff member, while a claimed invoice belongs to exactly one
 * staffer. Admins are unscoped and see everything.
 */
export function staffInvoiceScope(staffId: string) {
  return or(
    eq(invoices.assignedTo, staffId),
    and(isNull(invoices.assignedTo), inArray(invoices.status, UNCLAIMED_STATUSES))
  );
}

/** True when this staffer may open/work the invoice (own or claimable). */
export function staffCanAccessInvoice(
  invoice: { assignedTo: string | null; status: string },
  staffId: string
) {
  if (invoice.assignedTo === staffId) return true;
  return (
    invoice.assignedTo === null &&
    (UNCLAIMED_STATUSES as readonly string[]).includes(invoice.status)
  );
}

export type OfficeUser = { id: string; role: string; name?: string };
export type ClientUser = { clientId: string; role: string; sub: string; name?: string };

/**
 * Office scoping (shared): admin sees everything, staff see unclaimed work
 * plus their own claimed invoices. Returns the invoice or a 404 response
 * (same shape so staff cannot probe other staff's rows).
 */
export async function officeInvoiceOr404(id: string, user: OfficeUser) {
  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, id), notDeleted()),
  });
  if (!invoice) {
    return { error: NextResponse.json({ error: "Invoice not found" }, { status: 404 }) as NextResponse };
  }
  if (user.role !== "admin" && !staffCanAccessInvoice(invoice, user.id)) {
    return { error: NextResponse.json({ error: "Invoice not found" }, { status: 404 }) as NextResponse };
  }
  return { invoice };
}

/**
 * Client scoping (shared): own client's rows only. Team staff are further
 * scoped to rows THEY uploaded (owner sees everything).
 */
export async function clientInvoiceOr404(id: string, client: ClientUser) {
  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, id), notDeleted()),
  });
  if (!invoice || invoice.clientId !== client.clientId) {
    return { error: NextResponse.json({ error: "Invoice not found." }, { status: 404 }) as NextResponse };
  }
  if (client.role === "client_staff" && invoice.uploadedByStaffId !== client.sub) {
    return { error: NextResponse.json({ error: "Invoice not found." }, { status: 404 }) as NextResponse };
  }
  return { invoice };
}
