import { NextResponse } from "next/server";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, invoices } from "@/db/schema";
import { notDeleted } from "@/lib/invoice-access";
import type { OfficeSession } from "@/lib/session";

/**
 * Shared invoice-list filters for GET /api/invoices, /stats and /export.
 * Throws a NextResponse (400) on invalid params — routes return it directly.
 */
export type InvoiceFilters = {
  status?: string;
  assignedTo?: string; // "me" | "unassigned" | uuid
  outlet?: string;
  client?: string;
  category?: string;
  priority?: string;
  q?: string;
  from?: string;
  to?: string;
};

export const VALID_STATUSES = [
  "uploaded", "ocr_pending", "ocr_done", "ocr_failed", "assigned",
  "in_review", "needs_info", "verified", "collected", "disputed",
];
/** Staff-dashboard shorthands (also accepted by the list/stats/export APIs). */
export const PSEUDO_STATUSES: Record<string, string[]> = {
  in_progress: ["in_review", "needs_info"],
  finished: ["collected", "disputed"],
};
export const VALID_PRIORITIES = ["low", "normal", "urgent"];
const UUID_RE = /^[0-9a-f-]{36}$/i;

export function parseInvoiceFilters(params: URLSearchParams): InvoiceFilters | NextResponse {
  const get = (k: string) => {
    const v = params.get(k)?.trim();
    return v ? v : undefined;
  };
  const status = get("status");
  const assignedTo = get("assigned_to");
  const outlet = get("outlet");
  const client = get("client");
  const category = get("category");
  const priority = get("priority");
  const q = get("q");
  const from = get("from");
  const to = get("to");

  if (status && !VALID_STATUSES.includes(status) && !(status in PSEUDO_STATUSES)) {
    return NextResponse.json({ error: "Invalid status filter." }, { status: 400 });
  }
  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return NextResponse.json({ error: "Invalid priority filter." }, { status: 400 });
  }
  for (const [label, v] of [["outlet", outlet], ["client", client]] as const) {
    if (v && !UUID_RE.test(v)) {
      return NextResponse.json({ error: `Invalid ${label} filter.` }, { status: 400 });
    }
  }
  if (assignedTo && assignedTo !== "me" && assignedTo !== "unassigned" && !UUID_RE.test(assignedTo)) {
    return NextResponse.json({ error: "Invalid assigned_to filter." }, { status: 400 });
  }
  if (from && Number.isNaN(Date.parse(from))) {
    return NextResponse.json({ error: "Invalid from date." }, { status: 400 });
  }
  if (to && Number.isNaN(Date.parse(to))) {
    return NextResponse.json({ error: "Invalid to date." }, { status: 400 });
  }
  return { status, assignedTo, outlet, client, category, priority, q, from, to };
}

/**
 * Build the WHERE conditions for the shared filters. Staff callers ALWAYS
 * add their own assignedTo=me first (strict separation — any staff-supplied
 * assigned_to value is ignored).
 */
export async function buildInvoiceConditions(
  f: InvoiceFilters,
  me: OfficeSession,
  opts?: { skipStatus?: boolean }
) {
  // Soft-deleted rows are invisible to every list/stat/export.
  const conditions: Array<ReturnType<typeof eq> | ReturnType<typeof sql>> = [notDeleted()];

  if (me.role !== "admin") {
    conditions.push(eq(invoices.assignedTo, me.id));
  } else if (f.assignedTo === "me") {
    conditions.push(eq(invoices.assignedTo, me.id));
  } else if (f.assignedTo === "unassigned") {
    conditions.push(sql`${invoices.assignedTo} IS NULL`);
  } else if (f.assignedTo) {
    conditions.push(eq(invoices.assignedTo, f.assignedTo));
  }

  if (f.status && !opts?.skipStatus) {
    const pseudo = PSEUDO_STATUSES[f.status];
    conditions.push(
      pseudo
        ? inArray(invoices.status, pseudo as any)
        : eq(invoices.status, f.status as any)
    );
  }
  if (f.outlet) conditions.push(eq(invoices.outletId, f.outlet));
  if (f.client) conditions.push(eq(invoices.clientId, f.client));
  if (f.category) conditions.push(eq(invoices.category, f.category as any));
  if (f.priority) conditions.push(eq(invoices.priority, f.priority as any));
  if (f.from) conditions.push(sql`${invoices.createdAt} >= ${f.from}::timestamptz`);
  if (f.to) conditions.push(sql`${invoices.createdAt} <= ${f.to}::timestamptz`);

  // Search: client name, invoice no, vendor, id prefix.
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    const matchingClients = await db.query.clients.findMany({
      where: sql`name ILIKE ${like}`,
      columns: { id: true },
    });
    const ors = [
      sql`${invoices.id}::text LIKE ${f.q + "%"}`,
      sql`${invoices.ocrData}->>'vendor' ILIKE ${like}`,
      sql`${invoices.ocrData}->>'invoiceNo' ILIKE ${like}`,
    ];
    if (matchingClients.length > 0) {
      ors.push(inArray(invoices.clientId, matchingClients.map((c) => c.id)));
    }
    conditions.push(sql`(${sql.join(ors, sql` OR `)})`);
  }

  return conditions;
}

export function combineConditions(
  conditions: Array<ReturnType<typeof eq> | ReturnType<typeof sql>>
): ReturnType<typeof and> | undefined {
  return conditions.length > 0 ? and(...(conditions as any)) : undefined;
}

/** Server-computed dashboard numbers honoring the shared filters. */
export async function computeInvoiceStats(f: InvoiceFilters, me: OfficeSession) {
  // Status breakdown ignores the status filter itself (otherwise selecting
  // a status collapses the cards to one bucket); everything else applies.
  const noStatus = await buildInvoiceConditions(f, me, { skipStatus: true });
  const all = await buildInvoiceConditions(f, me);

  const byStatusRows = await db
    .select({ status: invoices.status, n: count() })
    .from(invoices)
    .where(combineConditions(noStatus))
    .groupBy(invoices.status);
  const byStatus: Record<string, number> = {};
  for (const s of VALID_STATUSES) byStatus[s] = 0;
  for (const r of byStatusRows) byStatus[r.status] = Number(r.n);

  const [totalRow] = await db
    .select({ n: count() })
    .from(invoices)
    .where(combineConditions(all));

  const unassignedConds = [...noStatus, sql`${invoices.assignedTo} IS NULL`];
  // Staff scope already forces assignedTo=me, so unassigned is 0 for staff.
  const [unRow] = await db
    .select({ n: count() })
    .from(invoices)
    .where(combineConditions(unassignedConds));

  const byPriorityRows = await db
    .select({ priority: invoices.priority, n: count() })
    .from(invoices)
    .where(combineConditions(all))
    .groupBy(invoices.priority);
  const byPriority: Record<string, number> = {};
  for (const p of VALID_PRIORITIES) byPriority[p] = 0;
  for (const r of byPriorityRows) {
    const key = r.priority as string;
    byPriority[key] = (byPriority[key] ?? 0) + Number(r.n);
  }

  return {
    byStatus,
    unassigned: Number(unRow?.n ?? 0),
    byPriority,
    total: Number(totalRow?.n ?? 0),
  };
}
