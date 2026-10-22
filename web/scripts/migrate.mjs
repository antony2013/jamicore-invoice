/**
 * Apply pending SQL migrations without drizzle-kit (production image has no
 * dev dependencies). Uses drizzle's runtime migrator + postgres.js and reads
 * the SQL journal from src/db/migrations.
 *
 * Usage (Coolify terminal / pre-deployment command):
 *   node scripts/migrate.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  if (process.env.DATABASE_URL) return;
  for (const file of [".env", ".env.local", ".env.production"]) {
    try {
      const raw = readFileSync(resolve(root, file), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        const [, key, value] = m;
        if (process.env[key] === undefined) {
          process.env[key] = value.replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      // missing file is fine
    }
  }
}

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(sql), { migrationsFolder: resolve(root, "src/db/migrations") });
  console.log("Migrations up to date.");
} catch (error) {
  console.error("Migration failed:", error?.message || error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
