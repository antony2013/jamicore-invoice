interface RateLimitRecord {
  count: number;
  resetTime: number;
}

// In-memory rate limiting store (keyed by identifier, e.g. "client-login:jane.doe" or "upload:clientId").
//
// NOTE (production): this Map is per-process — it diverges across replicas /
// serverless instances and resets on restart. It is a Slice-1 guard, not a
// distributed limiter. For multi-instance production, replace with a shared
// store (Redis/Upstash) behind the same `checkRateLimit` signature.
// (Spec asks to confirm before adding services — this is that confirmation point.)
const rateLimitMap = new Map<string, RateLimitRecord>();

/**
 * Clean expired entries periodically.
 * Guarded so serverless/Edge imports don't leak intervals per-invocation.
 */
let cleanupScheduled = false;
function ensureCleanupScheduled() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitMap.entries()) {
      if (now > record.resetTime) {
        rateLimitMap.delete(key);
      }
    }
  }, 60 * 1000);
  // Don't keep the process alive just for cleanup (esp. worker/test runners)
  const t = timer as unknown as { unref?: () => void };
  if (typeof t.unref === "function") t.unref();
}
ensureCleanupScheduled();

/**
 * Checks and increments rate limit counter.
 * @param key Unique key for the rate limit subject (e.g. "client-login:jane.doe")
 * @param maxLimit Maximum allowed attempts within window
 * @param windowMs Window duration in milliseconds
 * @returns { allowed: boolean, remaining: number, resetTime: number }
 */
export function checkRateLimit(
  key: string,
  maxLimit: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const existing = rateLimitMap.get(key);

  if (!existing || now > existing.resetTime) {
    const newRecord: RateLimitRecord = {
      count: 1,
      resetTime: now + windowMs,
    };
    rateLimitMap.set(key, newRecord);
    return {
      allowed: true,
      remaining: maxLimit - 1,
      resetTime: newRecord.resetTime,
    };
  }

  if (existing.count >= maxLimit) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: existing.resetTime,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: maxLimit - existing.count,
    resetTime: existing.resetTime,
  };
}
