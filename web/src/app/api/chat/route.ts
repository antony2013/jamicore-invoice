import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages } from "@/db/schema";
import { requireOffice } from "@/lib/session";
import { verifyClientToken, type ClientJWTPayload } from "@/lib/jwt";
import { resolveScope, type ChatParty } from "@/lib/chat-scope";
import { s3Client } from "@/lib/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

const CHAT_ATTACHMENT_LIMIT = 8 * 1024 * 1024;
const ALLOWED_CHAT_TYPES = ["image/jpeg", "image/png", "application/pdf"];

/**
 * Simple chat between office staff and the client, scoped to one outlet or
 * one invoice inside it. No AI: staff messages are stored with senderType
 * "staff", client messages (from the mobile/portal Bearer token) as "client".
 * GET  ?scopeType=&scopeId=   -> history (party inferred from cookie or Bearer)
 * POST multipart: scopeType, scopeId, message, file?
 */
function getParty(
  request: NextRequest
): Promise<{ party: ChatParty | null; client?: ClientJWTPayload }> {
  return (async () => {
    // Try office cookie session first.
    const me = await requireOffice();
    if (!(me instanceof NextResponse)) {
      return { party: { senderType: "staff", senderId: me.id } as ChatParty };
    }
    // Fall back to a client Bearer token (mobile app / client portal).
    const auth = request.headers.get("authorization") || "";
    if (auth.startsWith("Bearer ")) {
      const payload = await verifyClientToken(auth.slice(7));
      if (payload) {
        return { party: { senderType: "client", senderId: payload.sub }, client: payload };
      }
    }
    return { party: null };
  })();
}

export async function GET(request: NextRequest) {
  const { party, client } = await getParty(request);
  if (!party) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const scope = await resolveScope(
    { type: sp.get("scopeType"), id: sp.get("scopeId") },
    party.senderType === "staff" ? { staff: await currentStaff() } : { client: client! }
  );
  if (!scope) return NextResponse.json({ error: "Invalid chat scope." }, { status: 400 });

  try {
    const rows = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.scopeType, scope.type), eq(chatMessages.scopeId, scope.id)))
      .orderBy(asc(chatMessages.createdAt))
      .limit(200);
    return NextResponse.json({ success: true, messages: rows });
  } catch (e) {
    console.error("chat GET failed:", e);
    return NextResponse.json({ error: "Failed to load chat." }, { status: 500 });
  }
}

async function currentStaff() {
  const me = await requireOffice();
  return me instanceof NextResponse ? undefined : me;
}

export async function POST(request: NextRequest) {
  const { party, client } = await getParty(request);
  if (!party) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const viewer =
    party.senderType === "staff"
      ? { staff: await currentStaff() }
      : { client: client! };
  const scope = await resolveScope(
    { type: form.get("scopeType"), id: form.get("scopeId") },
    viewer
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
        senderType: party.senderType,
        senderId: party.senderId,
        body: message || null,
        attachmentS3Key,
        attachmentName,
      })
      .returning();

    return NextResponse.json({ success: true, message: inserted });
  } catch (e) {
    console.error("chat POST failed:", e);
    return NextResponse.json({ error: "Failed to send message." }, { status: 500 });
  }
}
