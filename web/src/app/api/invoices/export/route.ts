import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { writeAudit, getClientIp } from "@/lib/audit";
import {
  buildInvoiceConditions,
  combineConditions,
  parseInvoiceFilters,
} from "@/lib/invoice-filters";

/**
 * Admin CSV export (same filters, no pagination, max 20,000 rows). Streamed
 * so large exports never buffer the whole file in memory. Audit-logged with
 * the filter set and emitted row count.
 */
export const dynamic = "force-dynamic";

const MAX_EXPORT_ROWS = 20000;
const PAGE = 500;

const HEADER = [
  "id", "client", "phone", "outlet", "category", "category_detail",
  "status", "priority", "amount", "vendor", "invoice_no",
  "assigned_to", "created_at",
];

function esc(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  try {
    const me = await requireAdmin();
    if (me instanceof NextResponse) return me;

    const { searchParams } = new URL(request.url);
    const parsed = parseInvoiceFilters(searchParams);
    if (parsed instanceof NextResponse) return parsed;

    const baseConditions = await buildInvoiceConditions(parsed, me);

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(HEADER.join(",") + "\n"));
        let cursor: { createdAt: string; id: string } | null = null;
        let emitted = 0;
        try {
          for (;;) {
            const conditions = [...baseConditions];
            if (cursor) {
              conditions.push(
                sql`(${invoices.createdAt}, ${invoices.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
              );
            }
            const rows = await db.query.invoices.findMany({
              where: combineConditions(conditions as any),
              with: {
                client: { columns: { name: true, phone: true } },
                assignedStaff: { columns: { name: true } },
                outlet: { columns: { name: true } },
              },
              orderBy: [desc(invoices.createdAt), desc(invoices.id)],
              limit: PAGE,
            });
            if (rows.length === 0) break;
            for (const inv of rows) {
              if (emitted >= MAX_EXPORT_ROWS) break;
              const ocr = (inv.ocrData ?? {}) as Record<string, unknown>;
              controller.enqueue(
                enc.encode(
                  [
                    inv.id,
                    (inv as any).client?.name,
                    (inv as any).client?.phone,
                    (inv as any).outlet?.name,
                    (inv as any).category,
                    (inv as any).categoryDetail,
                    inv.status,
                    inv.priority,
                    ocr.amount,
                    ocr.vendor,
                    ocr.invoiceNo,
                    (inv as any).assignedStaff?.name,
                    inv.createdAt,
                  ]
                    .map(esc)
                    .join(",") + "\n"
                )
              );
              emitted++;
            }
            if (rows.length < PAGE || emitted >= MAX_EXPORT_ROWS) break;
            const lastRow = rows[rows.length - 1];
            cursor = {
              createdAt: (lastRow.createdAt as unknown as Date).toISOString(),
              id: lastRow.id,
            };
          }
          await writeAudit(db, {
            actor: { type: "staff", id: me.id },
            action: "invoice.export_csv",
            entityType: "invoice",
            entityId: null,
            after: { rows: emitted, capped: emitted >= MAX_EXPORT_ROWS },
            meta: { filters: parsed },
            ip: getClientIp(request),
          });
        } finally {
          controller.close();
        }
      },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="invoices-${stamp}.csv"`,
      },
    });
  } catch (error: any) {
    console.error("Error in GET /api/invoices/export:", error);
    return NextResponse.json({ error: "Failed to export invoices" }, { status: 500 });
  }
}
