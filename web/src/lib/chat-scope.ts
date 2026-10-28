// Chat scope resolution + authorization for outlet/invoice-scoped staff↔client chat.
// Office sessions (cookie) and client sessions (Bearer JWT) are both accepted:
//   - office staff: must have an invoice in the scope (strict assignedTo separation)
//   - client: scope must belong to their own clientId
// The senderType stored on each message is "staff" or "client".
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, invoices } from "@/db/schema";
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
  if (!UUID_RE.test(clientId) || !outletKey) return null;
  if (outletKey !== "none" && !UUID_RE.test(outletKey)) return null;
  if (viewer.client && viewer.client.clientId !== clientId) return null;
  if (!viewer.client && !viewer.staff) return null;

  // Existence probe scoped in SQL — never load a slice of the client's
  // invoices and filter in memory (that silently broke for clients with
  // more than 200 invoices).
  const conditions = [
    eq(invoices.clientId, clientId),
    outletKey === "none" ? isNull(invoices.outletId) : eq(invoices.outletId, outletKey),
    notDeleted(),
  ];
  // Strict separation: office staff only if they own at least one invoice here.
  if (viewer.staff && viewer.staff.role !== "admin") {
    conditions.push(eq(invoices.assignedTo, viewer.staff.id));
  }

  const rows = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(...conditions))
    .limit(1);

  return rows.length > 0 ? { type: "outlet", id } : null;
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

/**
 * Authorize a presigned chat-attachment read: the key must belong to a stored
 * chat message whose scope the caller can access. Without this, any signed-in
 * user holding a key could fetch another client's attachment.
 */
export async function resolveChatAttachmentScope(
  key: string,
  viewer: { staff?: OfficeSession; client?: ClientJWTPayload }
): Promise<ChatScope | null> {
  if (!key.startsWith("chat/") || key.includes("..")) return null;
  const row = await db.query.chatMessages.findFirst({
    where: eq(chatMessages.attachmentS3Key, key),
    columns: { scopeType: true, scopeId: true },
  });
  if (!row) return null;
  return resolveScope({ type: row.scopeType, id: row.scopeId }, viewer);
}
