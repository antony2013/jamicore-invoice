/**
 * DANGER: drops ALL app tables + the drizzle migration journal.
 * Intended for one-time recovery of a fresh/empty production database whose
 * schema got stuck half-created (e.g. failed first migrate). NEVER run this
 * on a database with real data — it deletes everything.
 *
 * Guarded by ALLOW_SEED=true (same gate as the seeder).
 * After reset: `npm run db:migrate` then `npx tsx src/db/seed.ts`.
 */
import postgres from "postgres";

async function main() {
  if (process.env.ALLOW_SEED !== "true") {
    console.error("Refusing: set ALLOW_SEED=true to enable db:reset.");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const client = postgres(url);
  await client.unsafe(`DROP TABLE IF EXISTS
    invoice_status_log, assignments, invoices, outlets, clients, staff CASCADE;`);
  await client.unsafe(`DROP SCHEMA IF EXISTS drizzle CASCADE;`);
  await client.end();
  console.log("Dropped app tables + migration journal. Now run: npm run db:migrate");
}

main().catch((err) => {
  console.error("db:reset failed:", err);
  process.exit(1);
});
