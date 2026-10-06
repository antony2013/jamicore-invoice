import { NextResponse } from "next/server";
import { requireOffice } from "@/lib/session";
import { officeInvoiceOr404 } from "@/lib/invoice-access";
import { generatePresignedViewUrl } from "@/lib/s3";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireOffice();
    if (me instanceof NextResponse) return me;

    const { id } = await params;

    const found = await officeInvoiceOr404(id, me);
    if ("error" in found) return found.error;
    const invoice = found.invoice;

    // Generate fresh short-lived signed GET URL (5 min TTL)
    const signedViewUrl = await generatePresignedViewUrl(invoice.s3Key);

    return NextResponse.json({
      success: true,
      url: signedViewUrl,
      expiresIn: 300, // 5 minutes
    });
  } catch (error: any) {
    console.error("Error generating view URL:", error);
    return NextResponse.json({ error: "Failed to generate image preview URL" }, { status: 500 });
  }
}
