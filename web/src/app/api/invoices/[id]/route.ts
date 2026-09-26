import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { invoices, invoiceStatusLog, assignments, outlets, staff } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isValidTransition, isTerminalStatus, InvoiceStatus } from "@/lib/status-flow";
import { categorySchema, validateCategory } from "@/lib/categories";
import { deleteObjectFromS3 } from "@/lib/s3";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.id, id),
      with: {
        client: true,
        assignedStaff: true,
        outlet: true,
        uploadedBy: true,
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Strict separation: staff see only invoices assigned to them.
    const role = (session.user as any).role as string;
    if (role !== "admin" && invoice.assignedTo !== (session.user as any).id) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Fetch audit trail history
    const logs = await db.query.invoiceStatusLog.findMany({
      where: eq(invoiceStatusLog.invoiceId, id),
      with: {
        actor: true,
      },
      orderBy: [desc(invoiceStatusLog.timestamp)],
    });

    return NextResponse.json({
      success: true,
      invoice,
      statusLogs: logs,
    });
  } catch (error: any) {
    console.error("Error in GET /api/invoices/[id]:", error);
    return NextResponse.json({ error: "Failed to fetch invoice" }, { status: 500 });
  }
}

const updateInvoiceSchema = z.object({
  status: z.enum([
    "in_review",
    "needs_info",
    "verified",
    "collected",
    "disputed",
  ]).optional(),
  ocrData: z.object({
    amount: z.union([z.number(), z.string()]).optional().nullable(),
    invoiceNo: z.string().optional().nullable(),
    date: z.string().optional().nullable(),
    vendor: z.string().optional().nullable(),
    rawText: z.string().optional().nullable(),
  }).optional(),
  priority: z.enum(["low", "normal", "urgent"]).optional(),
  note: z.string().optional(),
  // Admin/staff may (re)assign the outlet; must belong to the invoice's client. Null clears it.
  outletId: z.string().uuid("Invalid outlet ID").nullable().optional(),
  // Category correction + custom text for Other
  category: categorySchema.optional(),
  categoryDetail: z.string().trim().max(200).nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const staffId = (session.user as any).id;
    const { id } = await params;

    const body = await request.json();
    const result = updateInvoiceSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const currentInvoice = await db.query.invoices.findFirst({
      where: eq(invoices.id, id),
    });

    if (!currentInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Strict separation: staff mutate only their own assigned invoices.
    const actorRole = (session.user as any).role as string;
    if (actorRole !== "admin" && currentInvoice.assignedTo !== staffId) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Constraint: Check if already in terminal state
    if (isTerminalStatus(currentInvoice.status as InvoiceStatus)) {
      return NextResponse.json(
        {
          error: `Invoice is in terminal state '${currentInvoice.status}'. No further updates or transitions are allowed.`,
        },
        { status: 400 }
      );
    }

    const { status: nextStatus, ocrData, priority, note, outletId } = result.data;

    // Validate category + detail pair (Other requires custom text)
    const nextCategory = result.data.category ?? currentInvoice.category;
    const nextDetail =
      result.data.categoryDetail !== undefined
        ? result.data.categoryDetail
        : (currentInvoice as any).categoryDetail;
    const catError = validateCategory(nextCategory, nextDetail);
    if (catError) {
      return NextResponse.json({ error: catError }, { status: 400 });
    }

    // Validate status transition against the single centralized transition matrix
    if (nextStatus && nextStatus !== currentInvoice.status) {
      const allowed = isValidTransition(currentInvoice.status as InvoiceStatus, nextStatus as InvoiceStatus);
      if (!allowed) {
        return NextResponse.json(
          {
            error: `Illegal status transition from '${currentInvoice.status}' to '${nextStatus}'.`,
          },
          { status: 400 }
        );
      }
    }

    // Validate outlet belongs to the invoice's client (or null to clear)
    if (outletId !== undefined && outletId !== null) {
      const outlet = await db.query.outlets.findFirst({
        where: eq(outlets.id, outletId),
      });
      if (!outlet || outlet.clientId !== currentInvoice.clientId) {
        return NextResponse.json(
          { error: "Outlet does not belong to this invoice's client." },
          { status: 400 }
        );
      }
    }

    const updated = await db.transaction(async (tx) => {
      const updatePayload: any = {
        updatedAt: new Date(),
      };

      if (nextStatus) {
        updatePayload.status = nextStatus;
      }

      if (priority) {
        updatePayload.priority = priority;
      }

      if (outletId !== undefined) {
        updatePayload.outletId = outletId;
      }

      if (result.data.category !== undefined) {
        updatePayload.category = nextCategory;
        updatePayload.categoryDetail =
          nextCategory === "other" ? (nextDetail as string).trim() : null;
      } else if (result.data.categoryDetail !== undefined && currentInvoice.category === "other") {
        updatePayload.categoryDetail = result.data.categoryDetail?.trim() || null;
      }

      if (ocrData) {
        updatePayload.ocrData = {
          ...currentInvoice.ocrData,
          ...ocrData,
        };
      }

      const [res] = await tx
        .update(invoices)
        .set(updatePayload)
        .where(eq(invoices.id, id))
        .returning();

      // Always write audit log for status change; data-only edits log only
      // when an explicit note is provided (avoids timeline spam on every save).
      if (nextStatus && nextStatus !== currentInvoice.status) {
        await tx.insert(invoiceStatusLog).values({
          invoiceId: id,
          status: nextStatus,
          changedBy: staffId,
          note: note || `Status updated from ${currentInvoice.status} to ${nextStatus}`,
        });
      } else if (note) {
        await tx.insert(invoiceStatusLog).values({
          invoiceId: id,
          status: currentInvoice.status,
          changedBy: staffId,
          note,
        });
      }

      return res;
    });

    return NextResponse.json({
      success: true,
      invoice: updated,
    });
  } catch (error: any) {
    console.error("Error in PATCH /api/invoices/[id]:", error);
    return NextResponse.json({ error: "Failed to update invoice" }, { status: 500 });
  }
}

const TERMINAL_DELETE_BLOCKED = ["collected", "disputed"] as const;
const STAFF_DELETABLE = ["assigned", "in_review", "needs_info"] as const;

/**
 * Office delete (hard delete: DB row + cascade logs/assignments + S3 file).
 * - Admin: anything EXCEPT terminal collected/disputed (money trail stays).
 * - Staff: only own assigned invoices in pre-verification states
 *   (assigned/in_review/needs_info). Verified+ is an office decision.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = (session.user as any).role as string;
    const actorId = (session.user as any).id as string;
    const { id } = await params;

    const current = await db.query.invoices.findFirst({
      where: eq(invoices.id, id),
    });
    if (!current) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if ((TERMINAL_DELETE_BLOCKED as readonly string[]).includes(current.status)) {
      return NextResponse.json(
        { error: `Invoices in terminal state '${current.status}' cannot be deleted (audit trail).` },
        { status: 400 }
      );
    }

    if (role !== "admin") {
      if (current.assignedTo !== actorId) {
        return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      }
      if (!(STAFF_DELETABLE as readonly string[]).includes(current.status)) {
        return NextResponse.json(
          { error: `Status '${current.status}' can only be deleted by an admin.` },
          { status: 403 }
        );
      }
    }

    const s3Key = current.s3Key;
    await db.transaction(async (tx) => {
      await tx.delete(invoiceStatusLog).where(eq(invoiceStatusLog.invoiceId, id));
      await tx.delete(assignments).where(eq(assignments.invoiceId, id));
      await tx.delete(invoices).where(eq(invoices.id, id));
    });

    // Best-effort S3 cleanup (row is already gone; leftovers are invisible)
    const s3ok = await deleteObjectFromS3(s3Key);
    console.log(
      `Invoice ${id} deleted by ${role} ${actorId} (status was ${current.status}, s3 cleanup: ${s3ok})`
    );

    return NextResponse.json({
      success: true,
      message: s3ok ? "Invoice and file deleted." : "Invoice deleted (file cleanup pending).",
    });
  } catch (error: any) {
    console.error("Error in DELETE /api/invoices/[id]:", error);
    return NextResponse.json({ error: "Failed to delete invoice" }, { status: 500 });
  }
}
