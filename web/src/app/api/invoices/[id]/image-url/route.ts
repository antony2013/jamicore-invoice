import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { auth } from "@/lib/auth";
import { generatePresignedViewUrl } from "@/lib/s3";

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
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

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
