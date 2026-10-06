import { db } from "@/db";
import { auditLog } from "@/db/schema";
import type { DbTx } from "@/lib/invoice-transitions";

export type AuditActor = {
  type: "staff" | "client" | "client_staff" | "system" | string;
  id?: string | null;
};

export type AuditEntry = {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
};

/**
 * Append-only audit write. MUST be called inside the caller's transaction
 * (pass tx) so the entry commits atomically with the change it describes.
 * NEVER update or delete audit_log rows anywhere.
 */
export async function writeAudit(
  tx: DbTx | typeof db,
  entry: AuditEntry
): Promise<void> {
  await tx.insert(auditLog).values({
    actorType: entry.actor.type,
    actorId: entry.actor.id ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: (entry.before ?? null) as any,
    after: (entry.after ?? null) as any,
    meta: (entry.meta ?? null) as any,
    ip: entry.ip ?? null,
  });
}

/** Best-effort client IP (Coolify/Traefik sets x-forwarded-for). */
export function getClientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0]?.trim();
  return first || null;
}
