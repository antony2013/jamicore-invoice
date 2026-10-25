import { NextRequest, NextResponse } from "next/server";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { authenticateClientRequest } from "@/lib/jwt";
import { s3Client } from "@/lib/s3";

/** Presigned GET for a chat attachment (client side). Key must live under chat/. */
export async function GET(request: NextRequest) {
  const client = await authenticateClientRequest(request);
  if (!client) {
    return NextResponse.json(
      { error: "Unauthorized. Valid client Bearer token is required." },
      { status: 401 }
    );
  }
  const key = request.nextUrl.searchParams.get("key") ?? "";
  if (!key.startsWith("chat/") || key.includes("..")) {
    return NextResponse.json({ error: "Invalid attachment key." }, { status: 400 });
  }
  try {
    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME || "invoice-uploads",
        Key: key,
      }),
      { expiresIn: 300 }
    );
    return NextResponse.json({ success: true, url });
  } catch (e) {
    console.error("client chat attachment failed:", e);
    return NextResponse.json({ error: "Failed to resolve attachment." }, { status: 500 });
  }
}
