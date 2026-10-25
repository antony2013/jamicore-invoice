// Chat scope resolution + authorization for outlet/invoice-scoped staff↔client chat.
// Office sessions (cookie) and client sessions (Bearer JWT) are both accepted:
//   - office staff: must have an invoice in the scope (strict assignedTo separation)
//   - client: scope must belong to their own clientId
// The senderType stored on each message is "staff" or "client".
import { and, eq, not } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { notDeleted } from "@/lib/invoice-access";
import type { OfficeSession } from "@/lib/session";
import type { ClientJWTPayload } from "@/lib/jwt";

export type ChatScope = { type: "outlet" | "invoice"; id: string };
export type ChatParty = { senderType: "staff" | "client"; senderId: string };

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Validate + authorize an outlet scope ("none" = the synthetic no-outlet group). */
export async function resolveOutletScope(
  id: string,
  viewer: { staff?: OfficeSession; client?: ClientJWTPayload }
): Promise<ChatScope | null> {
  const [clientId, outletKey] = id.split(":");
  if (!UUID_RE.test(clientId)) return null;
  if (outletKey !== "none" && !UUID_RE.test(outletKey)) return null;
  if (viewer.client && viewer.client.clientId !== clientId) return null;

  const rows = await db
    .select({ outletId: invoices.outletId, assignedTo: invoices.assignedTo })
    .from(invoices)
    .where(and(eq(invoices.clientId, clientId), notDeleted()))
    .limit(200);
  const scoped = rows.filter((r) => (r.outletId ?? "none") === outletKey);
  if (scoped.length === 0) return null;
  // Strict separation: office staff only if they own at least one invoice here.
  if (viewer.staff && viewer.staff.role !== "admin" && !scoped.some((r) => r.assignedTo === viewer.staff!.id)) {
    return null;
  }
  return { type: "outlet", id };
}

/** Validate + authorize an invoice scope (a single invoice inside an outlet). */
export async function resolveInvoiceScope(
  id: string,
  viewer: { staff?: OfficeSession; client?: ClientJWTPayload }
): Promise<ChatScope | null> {
  if (!UUID_RE.test(id)) return null;
  const inv = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, id), notDeleted()),
  });
  if (!inv) return null;
  if (viewer.client && viewer.client.clientId !== inv.clientId) return null;
  if (viewer.staff && viewer.staff.role !== "admin" && inv.assignedTo !== viewer.staff.id) return null;
  return { type: "invoice", id };
}

export async function resolveScope(
  raw: { type?: any; id?: any },
  viewer: { staff?: OfficeSession; client?: ClientJWTPayload }
): Promise<ChatScope | null> {
  const id = String(raw.id ?? "").trim();
  if (raw.type === "invoice") return resolveInvoiceScope(id, viewer);
  if (raw.type === "outlet") return resolveOutletScope(id, viewer);
  return null;
}
