/**
 * Hard purge of soft-deleted invoices. ADMIN/CLI ONLY — never an API route.
 * Deletes DB rows first, S3 objects only AFTER commit, then writes one
 * audit_log row per purge run.
 *
 *   npx tsx src/db/purge-deleted.ts                              # dry run (DEFAULT)
 *   npx tsx src/db/purge-deleted.ts --older-than-days=30         # dry run, custom age
 *   npx tsx src/db/purge-deleted.ts --older-than-days=30 --apply  # actually purge
 */
import * as dotenv from "dotenv";
dotenv.config(); // local .env; production env passes through untouched
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db, closeDb } from "@/db";
import { invoices } from "@/db/schema";
import { deleteObjectFromS3 } from "@/lib/s3";
import { writeAudit } from "@/lib/audit";

async function main() {
  const apply = process.argv.includes("--apply");
  const olderArg = process.argv.find((a) => a.startsWith("--older-than-days="))?.split("=")[1];
  const olderThanDays = olderArg ? parseInt(olderArg, 10) : 30;
  if (!Number.isInteger(olderThanDays) || olderThanDays < 0) {
    console.error("[purge] --older-than-days must be a non-negative integer.");
    process.exit(1);
  }
  console.log(
    `[purge] mode: ${apply ? "APPLY (destroying)" : "dry-run (no deletes)"}, older-than: ${olderThanDays}d`
  );

  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const doomed = await db.query.invoices.findMany({
    where: and(isNotNull(invoices.deletedAt), lt(invoices.deletedAt, cutoff)),
    columns: { id: true, s3Key: true, deleteReason: true },
  });
  console.log(`[purge] candidates: ${doomed.length}`);
  for (const d of doomed.slice(0, 10)) {
    console.log(`[purge]   ${d.id} (${d.deleteReason || "no reason"})`);
  }
  if (doomed.length > 10) console.log(`[purge]   ... and ${doomed.length - 10} more`);

  if (!apply || doomed.length === 0) {
    console.log("[purge] done (dry run — re-run with --apply to destroy).");
    await closeDb();
    process.exit(0);
  }

  // DB first (cascades take logs/assignments/messages/reports)...
  await db.transaction(async (tx) => {
    for (const d of doomed) {
      await tx.delete(invoices).where(eq(invoices.id, d.id));
    }
    await writeAudit(tx, {
      actor: { type: "system", id: "db:purge" },
      action: "invoice.hard_purge",
      entityType: "invoice",
      meta: { count: doomed.length, olderThanDays },
    });
  });

  // ...S3 only after commit.
  let s3Failures = 0;
  for (const d of doomed) {
    const ok = await deleteObjectFromS3(d.s3Key);
    if (!ok) s3Failures++;
  }
  console.log(`[purge] done: ${doomed.length} row(s) purged, ${s3Failures} S3 failure(s).`);
  await closeDb();
  process.exit(0);
}

main().catch((e) => {
  console.error("[purge] fatal:", e);
  process.exit(1);
});
