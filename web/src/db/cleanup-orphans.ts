/**
 * S3 orphan cleanup.
 * Lists objects under invoices/ and reports/ older than 24h that have NO
 * matching DB row (invoices.s3_key / invoice_reports.s3_key).
 *
 *   npx tsx src/db/cleanup-orphans.ts            # dry run (DEFAULT)
 *   npx tsx src/db/cleanup-orphans.ts --apply    # actually delete
 *
 * Run daily via cron (Coolify scheduled job or host crontab).
 */
import { ListObjectsV2Command, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import * as dotenv from "dotenv";
dotenv.config(); // local .env; production env passes through untouched
import { db } from "@/db";
import { invoices, invoiceReports } from "@/db/schema";

const BUCKET = process.env.S3_BUCKET_NAME || "invoice-uploads";
const REGION = process.env.AWS_REGION || "us-east-1";
const PREFIXES = ["invoices/", "reports/"];
const OLDER_THAN_MS = 24 * 60 * 60 * 1000;

function endpoint(): string | undefined {
  const ep = process.env.S3_ENDPOINT?.trim();
  if (!ep) return undefined;
  return ep.startsWith("http") ? ep : `https://${ep}`;
}

const client = new S3Client({
  region: REGION,
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
  ...(endpoint() ? { endpoint: endpoint() } : {}),
  forcePathStyle: true,
});

async function listAll(prefix: string) {
  const out: Array<{ Key: string; LastModified?: Date }> = [];
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token })
    );
    for (const o of res.Contents || []) {
      if (o.Key) out.push({ Key: o.Key, LastModified: o.LastModified });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`[cleanup-orphans] mode: ${apply ? "APPLY (deleting)" : "dry-run (no deletes)"}`);

  const [invRows, repRows] = await Promise.all([
    db.query.invoices.findMany({ columns: { s3Key: true } }),
    db.query.invoiceReports.findMany({ columns: { s3Key: true } }),
  ]);
  const live = new Set<string>([
    ...invRows.map((r) => r.s3Key),
    ...repRows.map((r) => r.s3Key),
  ]);
  console.log(`[cleanup-orphans] live DB keys: ${live.size}`);

  const cutoff = Date.now() - OLDER_THAN_MS;
  let orphans = 0;
  let deleted = 0;
  for (const prefix of PREFIXES) {
    const objects = await listAll(prefix);
    for (const o of objects) {
      const age = o.LastModified ? Date.now() - o.LastModified.getTime() : Infinity;
      if (live.has(o.Key) || age < OLDER_THAN_MS) continue;
      orphans++;
      console.log(`[cleanup-orphans] orphan: ${o.Key} (age ${Math.round(age / 3600000)}h)`);
      if (apply) {
        await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: o.Key }));
        deleted++;
      }
    }
  }
  console.log(
    `[cleanup-orphans] done: ${orphans} orphan(s)` +
      (apply ? `, ${deleted} deleted.` : ` (dry run — re-run with --apply to delete).`) +
      ` cutoff: ${new Date(cutoff).toISOString()}`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[cleanup-orphans] fatal:", e);
  process.exit(1);
});
