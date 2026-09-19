export type InvoiceStatus =
  | "uploaded"
  | "ocr_pending"
  | "ocr_done"
  | "ocr_failed"
  | "assigned"
  | "in_review"
  | "needs_info"
  | "verified"
  | "collected"
  | "disputed";

/**
 * Centralized allowed transition matrix.
 * No status transitions outside this table are permitted.
 * Terminal states have empty arrays.
 */
export const ALLOWED_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  uploaded: ["ocr_pending"],
  ocr_pending: ["ocr_done", "ocr_failed"],
  ocr_done: ["assigned"],
  ocr_failed: ["assigned"],
  assigned: ["in_review"],
  in_review: ["needs_info", "verified"],
  needs_info: ["in_review"],
  verified: ["collected", "disputed"],
  collected: [], // Terminal
  disputed: [],  // Terminal
} as const;

/**
 * Validates whether a transition from `from` to `to` is legally allowed.
 */
export function isValidTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(to);
}

/**
 * Checks if a status is terminal (cannot be modified or transitioned further).
 */
export function isTerminalStatus(status: InvoiceStatus): boolean {
  return status === "collected" || status === "disputed";
}
