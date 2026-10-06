import * as dotenv from "dotenv";
dotenv.config();

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET_NAME = process.env.S3_BUCKET_NAME || "invoice-uploads";
const REGION = process.env.AWS_REGION || "us-east-1";
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB (spec)

function getEndpoint(): string | undefined {
  const ep = process.env.S3_ENDPOINT?.trim();
  if (!ep) return undefined;
  if (ep.startsWith("http://") || ep.startsWith("https://")) {
    return ep;
  }
  return `https://${ep}`;
}

const endpoint = getEndpoint();
const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "false"
  ? false
  : Boolean(endpoint || process.env.S3_FORCE_PATH_STYLE === "true");

// Configure S3 client (compatible with MinIO, AWS S3, Cloudflare R2, LocalStack).
// In production, prefer IAM roles / env credentials; never commit real keys.
// requestChecksumCalculation WHEN_REQUIRED: newer SDKs attach a CRC32 header
// to every PutObject, which strict S3 emulators reject on presigned PUTs.
export const s3Client = new S3Client({
  region: REGION,
  requestChecksumCalculation: "WHEN_REQUIRED",
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
  ...(endpoint ? { endpoint } : {}),
  forcePathStyle,
});

const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export type AllowedContentType = (typeof ALLOWED_TYPES)[number];

/**
 * Generate a constrained presigned PUT URL for uploading an invoice image.
 *
 * S3-policy-level enforcement: the expected `contentLength` is embedded via
 * the `ContentLength` header on the signed PutObjectCommand, so S3 rejects
 * uploads whose body length differs. The caller (mobile) MUST send the same
 * Content-Length. A post-upload HeadObject size check in confirm-upload
 * remains as defense-in-depth.
 */
export async function generatePresignedUploadUrl(
  s3Key: string,
  contentType: string,
  contentLength: number
): Promise<string> {
  const normalized = contentType.toLowerCase();
  if (!(ALLOWED_TYPES as readonly string[]).includes(normalized)) {
    throw new Error(
      `Unsupported content-type: ${contentType}. Allowed types: ${ALLOWED_TYPES.join(", ")}`
    );
  }
  if (!Number.isInteger(contentLength) || contentLength <= 0 || contentLength > MAX_UPLOAD_BYTES) {
    throw new Error(`Invalid contentLength: must be 1..${MAX_UPLOAD_BYTES} bytes.`);
  }

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  // Short-lived upload URL (expires in 15 minutes)
  return getSignedUrl(s3Client, command, { expiresIn: 900 });
}

/**
 * Upload validation bundle: existence + size + stored ContentType +
 * first-bytes magic check. Used by confirm-upload before any DB row exists.
 */
export type UploadInspection = {
  exists: boolean;
  size?: number;
  contentType?: string;
  magicOk?: boolean;
  magicDetail?: string;
};

const MAGIC_BY_EXT: Record<string, Array<{ label: string; test: (b: Uint8Array) => boolean }>> = {
  jpg: [{ label: "JPEG FF D8 FF", test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  png: [
    {
      label: "PNG signature",
      test: (b) =>
        b.length >= 8 &&
        b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
        b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
    },
  ],
  pdf: [{ label: "%PDF-", test: (b) => b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d }],
};

/** Shared magic-byte check (also used for .xlsx report confirm). */
export function checkMagicBytes(bytes: Uint8Array, kind: "jpg" | "png" | "pdf" | "xlsx"): boolean {
  if (kind === "xlsx") {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }
  const rules = MAGIC_BY_EXT[kind];
  return rules ? rules.some((r) => r.test(bytes)) : false;
}

export async function inspectUploadObject(s3Key: string): Promise<UploadInspection> {
  try {
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }));
    const size = head.ContentLength;
    const contentType = head.ContentType;
    // First 16 bytes for the magic check (single small ranged GET).
    let magicOk: boolean | undefined;
    let magicDetail: string | undefined;
    try {
      const got = await s3Client.send(
        new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key, Range: "bytes=0-15" })
      );
      const bytes = new Uint8Array(await got.Body!.transformToByteArray());
      const ext = s3Key.split(".").pop()?.toLowerCase();
      if (ext === "jpg" || ext === "png" || ext === "pdf" || ext === "xlsx") {
        magicOk = checkMagicBytes(bytes, ext as "jpg" | "png" | "pdf" | "xlsx");
        magicDetail = magicOk ? undefined : `bad magic for .${ext}`;
      }
    } catch {
      magicOk = undefined; // ranged GET unsupported — skip the check, don't fail
    }
    return { exists: true, size, contentType, magicOk, magicDetail };
  } catch (error: unknown) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404) {
      return { exists: false };
    }
    console.error(`[S3] inspectUploadObject failed for "${s3Key}":`, error);
    return { exists: false };
  }
}

/**
 * Delete an object from S3 (client upload withdrawal).
 * Returns true on success (or if already gone); false on error.
 */
export async function deleteObjectFromS3(s3Key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key })
    );
    return true;
  } catch (error: unknown) {
    console.error(`[S3] DeleteObject failed for "${s3Key}":`, error);
    return false;
  }
}

/**
 * Generate a short-lived (5-minute TTL) signed GET URL to view an invoice image.
 * Never store or return permanent public URLs.
 */
export async function generatePresignedViewUrl(s3Key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
  });

  // 5-minute TTL (300 seconds)
  return getSignedUrl(s3Client, command, { expiresIn: 300 });
}

export const REPORT_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;
export const MAX_REPORT_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Report uploads (.xlsx only, office work product — NOT client invoices).
 * Key shape enforced: reports/<invoiceId>/<file>.xlsx
 */
export async function generatePresignedReportUploadUrl(
  s3Key: string,
  contentLength?: number
): Promise<string> {
  if (!/^reports\/[0-9a-f-]{36}\/[^/]+\.xlsx$/i.test(s3Key)) {
    throw new Error("Invalid report key. Expected reports/<invoiceId>/<file>.xlsx");
  }
  if (contentLength !== undefined) {
    if (!Number.isInteger(contentLength) || contentLength <= 0 || contentLength > MAX_REPORT_BYTES) {
      throw new Error(`Invalid contentLength: must be 1..${MAX_REPORT_BYTES} bytes.`);
    }
  }
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    ContentType: REPORT_CONTENT_TYPE,
    ...(contentLength !== undefined ? { ContentLength: contentLength } : {}),
  });
  return getSignedUrl(s3Client, command, { expiresIn: 900 });
}

/**
 * Server-side object write (used by the Excel report generator).
 */
export async function putObjectToS3(
  s3Key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key, Body: body, ContentType: contentType })
  );
}
