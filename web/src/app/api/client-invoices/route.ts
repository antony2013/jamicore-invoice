import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assignments, invoices, invoiceStatusLog } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";
import { isClientEditable, isClientWithdrawable } from "@/lib/client-edit-rules";

/**
 * Invoice history (mobile "My History" screen).
 * - Owner (role client): every upload of the client (own + all team staff).
 * - Team staff: ONLY their own uploads. One member can never see, edit or
 *   withdraw another member's rows — enforced here, not just in the UI.
 * Each invoice carries its full status timeline (audit trail).
 */
export async function GET(request: Request) {
  try {
    const client = await authenticateClientRequest(request);
    if (!client) {
      return NextResponse.json(
        { error: "Unauthorized. Valid client Bearer token is required." },
        { status: 401 }
      );
    }

    const scope =
      client.role === "client_staff"
        ? and(eq(invoices.clientId, client.clientId), eq(invoices.uploadedByStaffId, client.sub))
        : eq(invoices.clientId, client.clientId);

    const rows = await db.query.invoices.findMany({
      where: scope,
      with: { outlet: true, uploadedBy: true },
      orderBy: [desc(invoices.createdAt)],
      limit: 100,
    });

    // Which rows were manually assigned (admin hand involved)? One query.
    const manualRows =
      rows.length > 0
        ? await db.query.assignments.findMany({
            where: inArray(
              assignments.invoiceId,
              rows.map((r) => r.id)
            ),
            columns: { invoiceId: true },
          })
        : [];
    const manualSet = new Set(manualRows.map((r) => r.invoiceId));

    const withLogs = await Promise.all(
      rows.map(async (inv) => {
        const logs = await db.query.invoiceStatusLog.findMany({
          where: eq(invoiceStatusLog.invoiceId, inv.id),
          orderBy: [desc(invoiceStatusLog.timestamp)],
        });
        const manual = manualSet.has(inv.id);
        return {
          id: inv.id,
          status: inv.status,
          priority: inv.priority,
          outlet: (inv as any).outlet ? { id: (inv as any).outlet.id, name: (inv as any).outlet.name } : null,
          ocrData: inv.ocrData
            ? {
                amount: (inv.ocrData as any).amount ?? null,
                invoiceNo: (inv.ocrData as any).invoiceNo ?? null,
                vendor: (inv.ocrData as any).vendor ?? null,
                date: (inv.ocrData as any).date ?? null,
                confidence: (inv.ocrData as any).confidence ?? null,
              }
            : null,
          clientNote: (inv as any).clientNote ?? null,
          pageNotes: ((inv as any).pageNotes as string[] | null) ?? null,
          uploadedByName: (inv as any).uploadedBy?.name ?? null,
          // Client withdrawal allowed within 1h of upload (server enforces)
          deletableUntil: new Date(new Date(inv.createdAt).getTime() + 60 * 60 * 1000).toISOString(),
          // UI mirrors: edit allowed pre-assignment + untouched auto-assigned
          editable: isClientEditable(inv.status, manual),
          withdrawable: isClientWithdrawable(inv.status, manual, inv.createdAt),
          category: (inv as any).category ?? "sales_invoice",
          categoryDetail: (inv as any).categoryDetail ?? null,
          createdAt: inv.createdAt,
          updatedAt: inv.updatedAt,
          statusLogs: logs.map((l) => ({
            status: l.status,
            note: l.note,
            timestamp: l.timestamp,
          })),
        };
      })
    );

    return NextResponse.json({ success: true, invoices: withLogs });
  } catch (error: unknown) {
    console.error("Error in GET /api/client-invoices:", error);
    return NextResponse.json({ error: "Failed to fetch invoice history" }, { status: 500 });
  }
}
