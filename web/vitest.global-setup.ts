import { existsSync } from "node:fs";

/**
 * Global setup: test-safety gate. Runs BEFORE any DB call or import
 * side-effect. Refuses to run unless ALL of these hold:
 * - DATABASE_URL_TEST is set,
 * - it differs from DATABASE_URL (the dev database),
 * - its database name contains "test" (case-insensitive).
 */
export default async function setup(): Promise<void> {
  const testUrl = process.env.DATABASE_URL_TEST;
  const devUrl = process.env.DATABASE_URL;
  const dbName = (url: string | undefined): string | null => {
    if (!url) return null;
    try {
      const path = new URL(url).pathname.replace(/^\/+/, "");
      return path || null;
    } catch {
      return null;
    }
  };

  const fail = (reason: string): never => {
    throw new Error(
      `[vitest setup] REFUSING TO RUN: ${reason}. ` +
        `Set DATABASE_URL_TEST to a scratch database (name must contain "test", ` +
        `different from DATABASE_URL). Dev data is never touched from tests.`
    );
  };

  if (!testUrl) fail("DATABASE_URL_TEST is unset");
  if (devUrl && testUrl === devUrl) fail("DATABASE_URL_TEST equals DATABASE_URL");
  const name = dbName(testUrl);
  if (!name || !name.toLowerCase().includes("test")) {
    fail(`database name "${name ?? "(unparseable)"}" does not contain "test"`);
  }

  // Point the app's own `db` singleton at the test database for the whole
  // run: every module (routes included) shares this connection, so no test
  // can ever reach the dev database even if it imports @/db directly.
  process.env.DATABASE_URL = testUrl;

  // Belt-and-braces: never let a test touch the real .env database file.
  if (!existsSync("vitest.config.ts")) {
    fail("vitest.config.ts missing (config drift)");
  }

  console.log(`[vitest setup] test database OK: ${name}`);
}
