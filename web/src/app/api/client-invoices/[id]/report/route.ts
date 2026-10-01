import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceReports } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";
import { clientInvoiceOr404 } from "@/lib/invoice-access";
import { generatePresignedViewUrl } from "@/lib/s3";

/**
 * Client side: download the office's Excel report for their OWN invoice.
 * Same visibility rule as the invoice itself (team staff: own uploads only).
 */
export async function GET(
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
    const found = await clientInvoiceOr404(id, client);
    if ("error" in found) return found.error;

    const report = await db.query.invoiceReports.findFirst({
      where: eq(invoiceReports.invoiceId, id),
      orderBy: [desc(invoiceReports.createdAt)],
    });
    if (!report) {
      return NextResponse.json({ success: true, report: null });
    }
    const downloadUrl = await generatePresignedViewUrl(report.s3Key);
    return NextResponse.json({
      success: true,
      report: {
        id: report.id,
        fileName: report.fileName,
        createdAt: report.createdAt,
        downloadUrl,
      },
    });
  } catch (error: any) {
    console.error("Error in GET /api/client-invoices/[id]/report:", error);
    return NextResponse.json({ error: "Failed to fetch report" }, { status: 500 });
  }
}
