import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { authenticateClientRequest } from "@/lib/jwt";
import { checkRateLimit } from "@/lib/rate-limiter";
import { generatePresignedUploadUrl, MAX_UPLOAD_BYTES } from "@/lib/s3";

const uploadUrlSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "application/pdf"], {
    errorMap: () => ({ message: "Only JPEG, PNG images and PDF files are supported" }),
  }),
  // Expected body size in bytes — embedded into the signed PUT so S3
  // rejects mismatched lengths at the policy level (not just client-side).
  contentLength: z.number().int().positive().max(MAX_UPLOAD_BYTES).optional(),
});

export async function POST(request: Request) {
  try {
    // 1. Mandatory client authentication (derived strictly from JWT token)
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json(
        { error: "Unauthorized. Valid client Bearer token is required." },
        { status: 401 }
      );
    }

    // 2. Rate-limiting: Max 30 upload-url requests per hour per client
    const rateLimitKey = `upload:${client.sub}`;
    const rateLimit = checkRateLimit(rateLimitKey, 30, 60 * 60 * 1000);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Upload rate limit exceeded. Please try again later.",
          resetTime: new Date(rateLimit.resetTime).toISOString(),
        },
        { status: 429 }
      );
    }

    // 3. Validate request payload
    const body = await request.json();
    const result = uploadUrlSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const { contentType, contentLength } = result.data;
    // Canonical extensions: image/jpeg -> .jpg, image/png -> .png, PDF -> .pdf
    const extension =
      contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : "jpg";

    // 4. Generate unique, scoped s3Key
    const invoiceFileId = crypto.randomUUID();
    const s3Key = `invoices/${client.sub}/${invoiceFileId}.${extension}`;

    // 5. Generate presigned PUT URL (Does NOT insert into DB yet)
    const uploadUrl = await generatePresignedUploadUrl(s3Key, contentType, contentLength);

    return NextResponse.json({
      success: true,
      uploadUrl,
      s3Key,
      expiresIn: 900, // 15 minutes
      maxBytes: MAX_UPLOAD_BYTES,
    });
  } catch (error: unknown) {
    console.error("Error in /api/invoices/upload-url:", error);
    return NextResponse.json(
      { error: "Internal server error while generating upload URL" },
      { status: 500 }
    );
  }
}
