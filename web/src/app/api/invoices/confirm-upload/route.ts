import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, invoices, invoiceStatusLog, outlets, staff } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";
import { checkObjectExistsInS3, MAX_UPLOAD_BYTES } from "@/lib/s3";

const confirmUploadSchema = z.object({
  s3Key: z.string().min(1, "s3Key is required"),
  // Optional client note typed in the mobile app (max 500 chars)
  note: z.string().trim().max(500, "Note must be at most 500 characters").optional(),
  // Optional per-page notes, index-aligned with PDF pages (max 20 x 500)
  pageNotes: z.array(z.string().trim().max(500)).max(20).optional(),
  // Optional outlet (must belong to the authenticated client)
  outletId: z.string().uuid("Invalid outlet ID").optional(),
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

    // 2. Validate request body
    const body = await request.json();
    const result = confirmUploadSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const { s3Key } = result.data;
    const clientNote = result.data.note?.trim() ? result.data.note.trim() : null;
    const pageNotes =
      result.data.pageNotes && result.data.pageNotes.some((n) => n.length > 0)
        ? result.data.pageNotes
        : null;

    // Security check: uploads are scoped to the OWNING CLIENT folder
    // (team staff share it — per-uploader attribution goes on the row).
    if (!s3Key.startsWith(`invoices/${client.clientId}/`)) {
      return NextResponse.json(
        { error: "Access denied. s3Key does not belong to this authenticated client." },
        { status: 403 }
      );
    }

    // 3. Idempotency Check: if invoice row already exists for this s3Key, return existing row
    const existingInvoice = await db.query.invoices.findFirst({
      where: eq(invoices.s3Key, s3Key),
    });

    if (existingInvoice) {
      return NextResponse.json({
        success: true,
        message: "Invoice already confirmed (idempotent response)",
        invoice: existingInvoice,
      });
    }

    // 4. Verify the object actually exists in S3 (HeadObject check)
    const s3Check = await checkObjectExistsInS3(s3Key);
    if (!s3Check.exists) {
      return NextResponse.json(
        { error: "File not found in storage. Ensure file upload succeeded before confirmation." },
        { status: 400 }
      );
    }

    // Security check: Enforce maximum file size (15MB)
    if (s3Check.size !== undefined && s3Check.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Uploaded file size exceeds the 15MB limit." },
        { status: 400 }
      );
    }

    // Reject implausibly small files (e.g. a failed mobile read that stored
    // a few bytes of error text instead of a photo). Real photos are 50KB+.
    if (s3Check.size !== undefined && s3Check.size < 1024) {
      return NextResponse.json(
        { error: "Uploaded file is too small to be a photo. Please retake and upload again." },
        { status: 400 }
      );
    }

    // Outlet must belong to the authenticated client (never trust blindly)
    let outletId: string | null = null;
    if (result.data.outletId) {
      const outlet = await db.query.outlets.findFirst({
        where: eq(outlets.id, result.data.outletId),
      });
      if (!outlet || outlet.clientId !== client.clientId) {
        return NextResponse.json(
          { error: "Invalid outlet for this client." },
          { status: 400 }
        );
      }
      outletId = outlet.id;
    }

    // Client default-staff routing: if this client has a default staff
    // member, new uploads skip straight to `assigned` (no OCR in between).
    let autoAssignee: { id: string; name: string } | null = null;
    {
      const owner = await db.query.clients.findFirst({
        where: eq(clients.id, client.clientId),
      });
      const defaultId = (owner as { assignedStaffId?: string | null })?.assignedStaffId;
      if (defaultId) {
        const target = await db.query.staff.findFirst({ where: eq(staff.id, defaultId) });
        if (target && (target as { role?: string }).role === "staff") {
          autoAssignee = { id: target.id, name: target.name };
        }
      }
    }

    // 5. Insert invoice record within a transaction.
    // Race-safe: the s3_key unique constraint is the arbiter. If two
    // concurrent confirms race past the idempotency check, the loser
    // catches 23505 and returns the winner's row instead of a 500.
    try {
      const newInvoice = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(invoices)
        .values({
          clientId: client.clientId, // Owning client from JWT, never from body
          s3Key: s3Key,
          imageUrl: s3Key, // Internal private reference
          status: autoAssignee ? "assigned" : "uploaded",
          assignedTo: autoAssignee ? autoAssignee.id : null,
          priority: "normal",
          clientNote: clientNote,
          pageNotes: pageNotes,
          outletId: outletId,
          // Uploader attribution: team staff id, or null when the owner uploads
          uploadedByStaffId: client.role === "client_staff" ? client.sub : null,
        })
        .returning();

      // Write initial status audit log (changedBy is null for client/automated actions)
      await tx.insert(invoiceStatusLog).values({
        invoiceId: inserted.id,
        status: "uploaded",
        changedBy: null,
        note:
          client.role === "client_staff"
            ? `Invoice uploaded by ${client.staffName || client.name} (team staff)`
            : "Invoice uploaded by client",
      });

      if (autoAssignee) {
        await tx.insert(invoiceStatusLog).values({
          invoiceId: inserted.id,
          status: "assigned",
          changedBy: null,
          note: `Auto-assigned to ${autoAssignee.name} (client default staff)`,
        });
      }

      return inserted;
      });

      return NextResponse.json({
        success: true,
        message: autoAssignee
          ? `Invoice uploaded and assigned to ${autoAssignee.name}`
          : "Invoice successfully uploaded",
        invoice: newInvoice,
      });
    } catch (txError: unknown) {
      // Concurrent duplicate: return the existing row (idempotent)
      const code =
        (txError as { code?: string })?.code ??
        (txError as { cause?: { code?: string } })?.cause?.code;
      if (code === "23505") {
        const existing = await db.query.invoices.findFirst({
          where: eq(invoices.s3Key, s3Key),
        });
        if (existing) {
          return NextResponse.json({
            success: true,
            message: "Invoice already confirmed (idempotent response)",
            invoice: existing,
          });
        }
      }
      throw txError;
    }
  } catch (error: unknown) {
    console.error("Error in /api/invoices/confirm-upload:", error);
    return NextResponse.json(
      { error: "Internal server error during upload confirmation" },
      { status: 500 }
    );
  }
}
