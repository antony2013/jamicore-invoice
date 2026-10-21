/**
 * Local dev bootstrap for the S3-compatible store (LocalStack).
 *
 * Creates the invoice bucket and applies the CORS rule the browser needs for
 * presigned PUT uploads (client invoices, office reports). Without CORS the
 * direct-to-S3 upload fails as "Failed to fetch".
 *
 * Usage: node scripts/init-local-s3.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  try {
    const raw = readFileSync(resolve(root, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const [, key, value] = m;
      if (process.env[key] === undefined) {
        process.env[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env is optional; fall back to the process environment.
  }
}

loadEnv();

const endpoint = process.env.S3_ENDPOINT || "http://localhost:4566";
const bucket = process.env.S3_BUCKET_NAME || "invoice-uploads";
const appOrigins = (process.env.S3_CORS_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "minioadmin",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "minioadmin",
  },
});

async function main() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`bucket "${bucket}" already exists`);
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`bucket "${bucket}" created`);
  }

  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: appOrigins,
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    })
  );
  console.log(`CORS set for ${appOrigins.join(", ")} on ${endpoint}/${bucket}`);
}

main().catch((error) => {
  console.error("init-local-s3 failed:", error?.message || error);
  process.exit(1);
});
