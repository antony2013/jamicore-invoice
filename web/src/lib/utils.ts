import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Short human-friendly invoice ID for cards and lists: a stable INV-xxxxxxx
 * derived from the row's UUID, so users never see raw 36-char ids and the
 * business job number (JC-YYYYMMDD-NNNN) stays a separate field.
 */
export function shortInvoiceId(inv: { id: string }): string {
  const hex = String(inv.id || "").replace(/-/g, "");
  return `INV-${hex.slice(0, 7) || "unknown"}`;
}

/**
 * OCR invoice number as shown in the UI. Prefixed with INV- so it can never be
 * mistaken for a job number (JC-YYYYMMDD-NNNN) when both appear side by side.
 */
export function formatInvoiceNo(invoiceNo?: string | null): string {
  const v = (invoiceNo ?? "").trim();
  if (!v) return "";
  return /^inv/i.test(v) ? v : `INV-${v}`;
}
