import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages } from "@/db/schema";
import { authenticateClientRequest, type ClientJWTPayload } from "@/lib/jwt";
import { resolveScope } from "@/lib/chat-scope";
import { s3Client } from "@/lib/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

const CHAT_ATTACHMENT_LIMIT = 8 * 1024 * 1024;
const ALLOWED_CHAT_TYPES = ["image/jpeg", "image/png", "application/pdf"];

/**
 * Client (mobile/portal) side of the scoped staff↔client chat.
 * Bearer-token auth; the scope must belong to the caller's own clientId.
 * GET  ?scopeType=&scopeId= -> history
 * POST multipart: scopeType, scopeId, message, file? -> sent message
 */
async function party(request: NextRequest) {
  const client: ClientJWTPayload | null = await authenticateClientRequest(request);
  if (!client) return null;
  return client;
}

export async function GET(request: NextRequest) {
  const client = await party(request);
  if (!client) {
    return NextResponse.json(
      { error: "Unauthorized. Valid client Bearer token is required." },
      { status: 401 }
    );
  }
  const sp = request.nextUrl.searchParams;
  const scope = await resolveScope(
    { type: sp.get("scopeType"), id: sp.get("scopeId") },
    { client }
  );
  if (!scope) return NextResponse.json({ error: "Invalid chat scope." }, { status: 400 });

  try {
    const rows = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.scopeType, scope.type), eq(chatMessages.scopeId, scope.id)))
      .limit(200);
    return NextResponse.json({ success: true, messages: rows });
  } catch (e) {
    console.error("client chat GET failed:", e);
    return NextResponse.json({ error: "Failed to load chat." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const client = await party(request);
  if (!client) {
    return NextResponse.json(
      { error: "Unauthorized. Valid client Bearer token is required." },
      { status: 401 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const scope = await resolveScope(
    { type: form.get("scopeType"), id: form.get("scopeId") },
    { client }
  );
  if (!scope) return NextResponse.json({ error: "Invalid chat scope." }, { status: 400 });

  const message = String(form.get("message") ?? "").trim().slice(0, 2000);
  const file = form.get("file");
  if (!message && !(file instanceof File)) {
    return NextResponse.json({ error: "Message or attachment required." }, { status: 400 });
  }

  try {
    let attachmentS3Key: string | null = null;
    let attachmentName: string | null = null;
    if (file instanceof File) {
      if (file.size > CHAT_ATTACHMENT_LIMIT) {
        return NextResponse.json({ error: "Attachment must be under 8 MB." }, { status: 400 });
      }
      if (!ALLOWED_CHAT_TYPES.includes(file.type)) {
        return NextResponse.json(
          { error: "Only image (JPEG/PNG) or PDF attachments are allowed." },
          { status: 400 }
        );
      }
      const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 80) || "attachment";
      attachmentS3Key = `chat/${randomUUID()}-${safeName}`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME || "invoice-uploads",
          Key: attachmentS3Key,
          Body: Buffer.from(await file.arrayBuffer()),
          ContentType: file.type,
          ContentLength: file.size,
        })
      );
      attachmentName = safeName;
    }

    const [inserted] = await db
      .insert(chatMessages)
      .values({
        scopeType: scope.type,
        scopeId: scope.id,
        senderType: "client",
        senderId: client.sub,
        body: message || null,
        attachmentS3Key,
        attachmentName,
      })
      .returning();
    return NextResponse.json({ success: true, message: inserted });
  } catch (e) {
    console.error("client chat POST failed:", e);
    return NextResponse.json({ error: "Failed to send message." }, { status: 500 });
  }
}
