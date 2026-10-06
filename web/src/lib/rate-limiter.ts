import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Postgres-backed fixed-window rate limiter (shared across processes and
 * restarts — one row per key in `rate_limits`). Atomic via a single
 * INSERT ... ON CONFLICT upsert; expired rows are cleaned opportunistically
 * on ~1% of calls.
 */
export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetTime: number;
};

export async function checkRateLimit(
  key: string,
  maxLimit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  // ISO strings (not Date objects) — the pg driver serializes these
  // deterministically across drizzle versions.
  const windowEndIso = new Date(now + windowMs).toISOString();

  // Opportunistic cleanup (~1% of calls, fire-and-forget)
  if (Math.random() < 0.01) {
    db.execute(sql`DELETE FROM rate_limits WHERE reset_at < now()`).catch(() => undefined);
  }

  const rows = (await db.execute(sql`
    INSERT INTO rate_limits (key, count, reset_at)
    VALUES (${key}, 1, ${windowEndIso}::timestamptz)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at <= now() THEN ${windowEndIso}::timestamptz ELSE rate_limits.reset_at END
    RETURNING count, reset_at
  `)) as unknown as Array<{ count: number; reset_at: Date | string }>;

  const row = rows[0];
  const count = Number(row?.count ?? 1);
  const resetTime = new Date(row?.reset_at ?? windowEndIso).getTime();
  return {
    allowed: count <= maxLimit,
    remaining: Math.max(0, maxLimit - count),
    resetTime,
  };
}
