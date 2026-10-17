import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Short human-friendly invoice ID for cards and lists. Prefers the OCR
 * invoice number; otherwise derives a stable INV-xxxxxxx from the row's
 * UUID so users never see raw 36-char ids.
 */
export function shortInvoiceId(inv: {
  id: string;
  ocrData?: { invoiceNo?: string | null } | null;
}): string {
  const ocrNo = inv.ocrData?.invoiceNo?.trim();
  if (ocrNo) return ocrNo;
  const hex = String(inv.id || "").replace(/-/g, "");
  return `INV-${hex.slice(0, 7) || "unknown"}`;
}
