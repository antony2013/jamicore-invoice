import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";

/** Invoices that still need a human (open work). */
export const OPEN_INVOICE_STATUSES = ["assigned", "in_review", "needs_info"] as const;

export type OfficeUser = { id: string; role: string; name?: string };
export type ClientUser = { clientId: string; role: string; sub: string; name?: string };

/**
 * Office scoping (shared): admin sees everything, staff only their own
 * assigned invoices. Returns the invoice or a 404 response (same shape so
 * staff cannot probe other rows).
 */
export async function officeInvoiceOr404(id: string, user: OfficeUser) {
  const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
  if (!invoice) {
    return { error: NextResponse.json({ error: "Invoice not found" }, { status: 404 }) as NextResponse };
  }
  if (user.role !== "admin" && invoice.assignedTo !== user.id) {
    return { error: NextResponse.json({ error: "Invoice not found" }, { status: 404 }) as NextResponse };
  }
  return { invoice };
}

/**
 * Client scoping (shared): own client's rows only. Team staff are further
 * scoped to rows THEY uploaded (owner sees everything).
 */
export async function clientInvoiceOr404(id: string, client: ClientUser) {
  const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
  if (!invoice || invoice.clientId !== client.clientId) {
    return { error: NextResponse.json({ error: "Invoice not found." }, { status: 404 }) as NextResponse };
  }
  if (client.role === "client_staff" && invoice.uploadedByStaffId !== client.sub) {
    return { error: NextResponse.json({ error: "Invoice not found." }, { status: 404 }) as NextResponse };
  }
  return { invoice };
}
