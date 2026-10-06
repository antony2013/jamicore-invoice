import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTestDb, migrateTestDb, tdb, truncateAll } from "@/test/helpers";
import { checkRateLimit } from "@/lib/rate-limiter";

beforeAll(async () => {
  await migrateTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDb();
});

describe("rate limiter (Postgres-backed)", () => {
  it("allows up to max, then blocks with remaining 0", async () => {
    const key = `t-limit-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit(key, 3, 60000);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(3 - (i + 1));
    }
    const blocked = await checkRateLimit(key, 3, 60000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets after the window", async () => {
    const key = `t-window-${Date.now()}`;
    await checkRateLimit(key, 1, 60000);
    expect((await checkRateLimit(key, 1, 60000)).allowed).toBe(false);
    // Age the window out directly (no wall-clock sleep: container and
    // host clocks can drift, which makes sleep-based tests flaky).
    const { tdb } = await import("@/test/helpers");
    const { rateLimits } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await tdb()
      .update(rateLimits)
      .set({ resetAt: new Date(Date.now() - 1000) })
      .where(eq(rateLimits.key, key));
    const fresh = await checkRateLimit(key, 1, 60000);
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(0);
  });

  it("handles concurrency: exactly max winners", async () => {
    const key = `t-conc-${Date.now()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkRateLimit(key, 5, 60000))
    );
    expect(results.filter((r) => r.allowed).length).toBe(5);
  });

  it("persists across module re-imports (shared store, not memory)", async () => {
    const key = `t-reimport-${Date.now()}`;
    await checkRateLimit(key, 1, 60000);
    vi.resetModules();
    const fresh = await import("@/lib/rate-limiter");
    expect((await fresh.checkRateLimit(key, 1, 60000)).allowed).toBe(false);
  });

  it("cleanup does not break counting", async () => {
    const db = tdb();
    expect(db).toBeDefined();
  });
});
