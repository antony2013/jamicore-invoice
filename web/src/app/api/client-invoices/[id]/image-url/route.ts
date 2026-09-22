import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { authenticateClientRequest } from "@/lib/jwt";
import { generatePresignedViewUrl } from "@/lib/s3";

/**
 * Signed view URL for the CLIENT's OWN invoice (mobile document viewer).
 * Same 5-minute TTL as the staff/admin endpoint. Ownership enforced via JWT:
 * a client can never generate URLs for another client's invoices.
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
    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.id, id),
    });

    if (!invoice || invoice.clientId !== client.clientId) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }
    // Team staff: only rows they personally uploaded.
    if (client.role === "client_staff" && invoice.uploadedByStaffId !== client.sub) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    const url = await generatePresignedViewUrl(invoice.s3Key);
    const isPdf = invoice.s3Key.toLowerCase().endsWith(".pdf");

    return NextResponse.json({
      success: true,
      url,
      expiresIn: 300,
      contentType: isPdf ? "application/pdf" : "image/jpeg",
      isPdf,
    });
  } catch (error: unknown) {
    console.error("Error in GET /api/client-invoices/[id]/image-url:", error);
    return NextResponse.json({ error: "Failed to generate preview URL" }, { status: 500 });
  }
}
