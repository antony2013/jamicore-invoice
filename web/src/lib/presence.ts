import { eq } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";

export const ONLINE_WINDOW_MS = 5 * 60 * 1000; // Online = active within 5 min

/**
 * Fire-and-forget presence heartbeat. Never blocks the request, never throws.
 * Called from the list APIs the dashboards already poll (invoices, history,
 * staff, clients, outlets) — so "online" accurately means "working now".
 * NOTE: never call from Edge middleware (postgres.js needs Node runtime).
 */
export function touchPresence(staffId: string | undefined | null) {
  if (!staffId) return;
  void db
    .update(staff)
    .set({ lastSeenAt: new Date() })
    .where(eq(staff.id, staffId))
    .catch((err) => console.error("[presence] heartbeat failed:", err));
}

/** Shared formatter for "x min ago" labels (server + client safe). */
export function presenceLabel(lastSeenAt: Date | string | null | undefined, now = Date.now()): string {
  if (!lastSeenAt) return "Never active";
  const ms = now - new Date(lastSeenAt).getTime();
  if (ms < 0) return "Online";
  if (ms < ONLINE_WINDOW_MS) return "Online";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
