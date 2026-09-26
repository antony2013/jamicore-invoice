import { z } from "zod";

/** Main upload categories. `other` requires free text (categoryDetail). */
export const INVOICE_CATEGORIES = [
  "sales_invoice",
  "purchase_bill",
  "expense_bill",
  "asset_bill",
  "other",
] as const;

export type InvoiceCategory = (typeof INVOICE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<InvoiceCategory, string> = {
  sales_invoice: "Sales Invoice",
  purchase_bill: "Purchase Bill",
  expense_bill: "Expense Bill",
  asset_bill: "Asset Bill",
  other: "Other",
};

export const categorySchema = z.enum(INVOICE_CATEGORIES);

/**
 * Validate a category + detail pair.
 * Returns an error string, or null when valid.
 */
export function validateCategory(
  category: string | undefined,
  detail: string | null | undefined
): string | null {
  if (category === undefined) return null;
  if (!(INVOICE_CATEGORIES as readonly string[]).includes(category)) {
    return "Invalid category.";
  }
  if (category === "other") {
    if (!detail || !detail.trim()) return "Custom category text is required when category is Other.";
    if (detail.trim().length > 200) return "Custom category text must be at most 200 characters.";
  } else if (detail && detail.trim()) {
    return "Custom category text is only allowed when category is Other.";
  }
  return null;
}
