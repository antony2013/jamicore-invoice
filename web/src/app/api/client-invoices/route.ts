import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, invoiceStatusLog } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";

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

    const withLogs = await Promise.all(
      rows.map(async (inv) => {
        const logs = await db.query.invoiceStatusLog.findMany({
          where: eq(invoiceStatusLog.invoiceId, inv.id),
          orderBy: [desc(invoiceStatusLog.timestamp)],
        });
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
