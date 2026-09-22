import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, invoiceStatusLog, outlets } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";
import { deleteObjectFromS3 } from "@/lib/s3";

/**
 * Client self-service on their OWN invoice.
 * Editable only BEFORE staff takes ownership: uploaded, ocr_pending,
 * ocr_done, ocr_failed. Once assigned (or beyond), the office owns the
 * record — client edits/deletes are rejected with 409.
 * Team staff are further scoped to rows THEY uploaded: one member can never
 * touch another member's uploads (owner sees/edits everything).
 */
const PRE_ASSIGNMENT = ["uploaded", "ocr_pending", "ocr_done", "ocr_failed"] as const;

const updateSchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
  pageNotes: z.array(z.string().trim().max(500)).max(20).optional(),
  outletId: z.string().uuid("Invalid outlet ID").nullable().optional(),
});

async function ownInvoiceOr404(
  invoiceId: string,
  client: { clientId: string; role: string; sub: string }
) {
  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, invoiceId),
  });
  if (!invoice || invoice.clientId !== client.clientId) {
    return { error: NextResponse.json({ error: "Invoice not found." }, { status: 404 }) as NextResponse };
  }
  // Team staff: only rows they personally uploaded. Owner: everything.
  if (client.role === "client_staff" && invoice.uploadedByStaffId !== client.sub) {
    return { error: NextResponse.json({ error: "Invoice not found." }, { status: 404 }) as NextResponse };
  }
  return { invoice };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json(
        { error: "Unauthorized. Valid client Bearer token is required." },
        { status: 401 }
      );
    }

    const { id } = await params;
    const found = await ownInvoiceOr404(id, client);
    if ("error" in found) return found.error;
    const current = found.invoice;

    if (!PRE_ASSIGNMENT.includes(current.status as (typeof PRE_ASSIGNMENT)[number])) {
      return NextResponse.json(
        { error: `Invoice is already with the office (status '${current.status}'). Contact them to make changes.` },
        { status: 409 }
      );
    }

    const body = await request.json();
    const result = updateSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const { note, pageNotes, outletId } = result.data;
    if (outletId !== undefined && outletId !== null) {
      const outlet = await db.query.outlets.findFirst({ where: eq(outlets.id, outletId) });
      if (!outlet || outlet.clientId !== client.clientId) {
        return NextResponse.json({ error: "Invalid outlet for this client." }, { status: 400 });
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (note !== undefined) patch.clientNote = note && note.length > 0 ? note : null;
    if (pageNotes !== undefined) {
      patch.pageNotes = pageNotes.some((n) => n.length > 0) ? pageNotes : null;
    }
    if (outletId !== undefined) patch.outletId = outletId;

    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(invoices)
        .set(patch)
        .where(eq(invoices.id, id))
        .returning();
      await tx.insert(invoiceStatusLog).values({
        invoiceId: id,
        status: row.status,
        changedBy: null,
        note: "Client updated invoice details",
      });
      return [row];
    });

    return NextResponse.json({ success: true, invoice: updated });
  } catch (error: unknown) {
    console.error("Error in PATCH /api/client-invoices/[id]:", error);
    return NextResponse.json({ error: "Failed to update invoice" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json(
        { error: "Unauthorized. Valid client Bearer token is required." },
        { status: 401 }
      );
    }

    const { id } = await params;
    const found = await ownInvoiceOr404(id, client);
    if ("error" in found) return found.error;
    const current = found.invoice;

    if (!PRE_ASSIGNMENT.includes(current.status as (typeof PRE_ASSIGNMENT)[number])) {
      return NextResponse.json(
        { error: `Invoice is already with the office (status '${current.status}') and cannot be withdrawn.` },
        { status: 409 }
      );
    }

    // DB row + logs first (assignments/status logs cascade); S3 object
    // best-effort after — a leftover object is invisible, a broken row is not.
    await db.transaction(async (tx) => {
      await tx.insert(invoiceStatusLog).values({
        invoiceId: id,
        status: current.status,
        changedBy: null,
        note: "Invoice withdrawn by client",
      });
      await tx.delete(invoices).where(eq(invoices.id, id));
    });

    const s3ok = await deleteObjectFromS3(current.s3Key);
    return NextResponse.json({
      success: true,
      message: s3ok
        ? "Invoice withdrawn and file deleted."
        : "Invoice withdrawn (file cleanup pending).",
    });
  } catch (error: unknown) {
    console.error("Error in DELETE /api/client-invoices/[id]:", error);
    return NextResponse.json({ error: "Failed to withdraw invoice" }, { status: 500 });
  }
}
