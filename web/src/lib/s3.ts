import * as dotenv from "dotenv";
dotenv.config();

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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

// Configure S3 client (compatible with MinIO, AWS S3, Cloudflare R2, or LocalStack)
// In production, prefer IAM roles / env credentials; never commit real keys.
export const s3Client = new S3Client({
  region: REGION,
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
  contentLength?: number
): Promise<string> {
  const normalized = contentType.toLowerCase();
  if (!(ALLOWED_TYPES as readonly string[]).includes(normalized)) {
    throw new Error(
      `Unsupported content-type: ${contentType}. Allowed types: ${ALLOWED_TYPES.join(", ")}`
    );
  }
  if (contentLength !== undefined) {
    if (!Number.isInteger(contentLength) || contentLength <= 0 || contentLength > MAX_UPLOAD_BYTES) {
      throw new Error(`Invalid contentLength: must be 1..${MAX_UPLOAD_BYTES} bytes.`);
    }
  }

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    ContentType: contentType,
    ...(contentLength !== undefined ? { ContentLength: contentLength } : {}),
  });

  // Short-lived upload URL (expires in 15 minutes)
  return getSignedUrl(s3Client, command, { expiresIn: 900 });
}

/**
 * Verify whether an object exists in S3 (HeadObject).
 * Required by Slice 1 to ensure an uploaded file actually exists before DB insert.
 *
 * FAILS CLOSED: any error (missing object, 403, network) returns exists:false
 * except when explicit mock mode is enabled via ALLOW_S3_MOCK=true
 * (local dev without S3). The old implicit "test credentials" bypass is removed.
 */
export async function checkObjectExistsInS3(s3Key: string): Promise<{ exists: boolean; size?: number }> {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });
    const response = await s3Client.send(command);
    return { exists: true, size: response.ContentLength };
  } catch (error: unknown) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404) {
      return { exists: false };
    }
    if (process.env.ALLOW_S3_MOCK === "true" && process.env.NODE_ENV !== "production") {
      console.warn(`[S3 MOCK] HeadObject failed for "${s3Key}" but ALLOW_S3_MOCK=true — treating as exists (dev only).`);
      return { exists: true, size: 1024 };
    }
    console.error(`[S3] HeadObject failed for "${s3Key}":`, error);
    return { exists: false };
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
