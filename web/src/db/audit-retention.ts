/**
 * Audit retention: export old append-only audit rows to JSONL, then prune
 * them only when both --archive and --delete are provided.
 *
 *   npx tsx src/db/audit-retention.ts --older-than-days=365 --archive=audit-old.jsonl
 *   npx tsx src/db/audit-retention.ts --older-than-days=365 --archive=audit-old.jsonl --delete
 *
 * Always keep the archived JSONL outside this repository before sharing.
 */
import * as dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.local", override: true });

import fs from "node:fs/promises";
import path from "node:path";
import { and, isNotNull, lt } from "drizzle-orm";
import { db, closeDb } from "@/db";
import { auditLog } from "@/db/schema";

async function main() {
  const applyDelete = process.argv.includes("--delete");
  const olderArg = process.argv.find((a) => a.startsWith("--older-than-days="))?.split("=")[1];
  const archiveArg = process.argv.find((a) => a.startsWith("--archive="))?.split("=")[1];
  const olderThanDays = olderArg ? parseInt(olderArg, 10) : 365;
  if (!Number.isInteger(olderThanDays) || olderThanDays < 0) {
    console.error("[audit-retention] --older-than-days must be a non-negative integer.");
    process.exit(1);
  }
  if (applyDelete && !archiveArg) {
    console.error("[audit-retention] --delete requires --archive=<file> so rows can be preserved offline.");
    process.exit(1);
  }

  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const oldRows = await db.query.auditLog.findMany({
    where: lt(auditLog.at, cutoff),
    orderBy: auditLog.at,
    limit: 100000,
  });

  console.log(`[audit-retention] candidates: ${oldRows.length}, older than ${olderThanDays}d (cutoff ${cutoff.toISOString()})`);
  if (oldRows.length === 0) {
    await closeDb();
    process.exit(0);
  }

  if (archiveArg) {
    const file = path.resolve(archiveArg);
    const lines = oldRows.map((r) => JSON.stringify({ ...r, at: r.at?.toISOString?.() ?? r.at }));
    await fs.writeFile(file, lines.join("\n") + "\n", "utf8");
    console.log(`[audit-retention] archived ${oldRows.length} row(s) -> ${file}`);
  }

  if (!applyDelete) {
    console.log("[audit-retention] dry-run archive only; re-run with --delete to prune.");
    await closeDb();
    process.exit(0);
  }

  await db.delete(auditLog).where(and(isNotNull(auditLog.at), lt(auditLog.at, cutoff)));
  console.log(`[audit-retention] pruned ${oldRows.length} row(s). Keep the archive file safe.`);
  await closeDb();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("[audit-retention] fatal:", e);
  await closeDb().catch(() => {});
  process.exit(1);
});
