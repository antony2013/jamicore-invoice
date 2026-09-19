import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { invoices, invoiceStatusLog, outlets, staff } from "@/db/schema";
import { auth } from "@/lib/auth";
import { isValidTransition, isTerminalStatus, InvoiceStatus } from "@/lib/status-flow";

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
      },
    });

    if (!invoice) {
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
