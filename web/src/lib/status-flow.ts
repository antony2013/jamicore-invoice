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
 *
 * NOTE: automated OCR was removed — new invoices go `uploaded -> assigned`
 * directly (manual assign, backlog sweep, or client-default auto-assign at
 * upload). The ocr_* states below are LEGACY only: old rows still sitting in
 * them can move forward to `assigned`, but nothing new ever enters them.
 * (Enum values stay in Postgres; dropping enum values is deliberately avoided.)
 */
export const ALLOWED_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  uploaded: ["assigned"],
  ocr_pending: ["ocr_done", "ocr_failed"], // legacy
  ocr_done: ["assigned"], // legacy drain
  ocr_failed: ["assigned"], // legacy drain
  assigned: ["in_review"],
  in_review: ["needs_info", "verified"],
  needs_info: ["in_review"],
  verified: ["collected", "disputed"],
  collected: [], // Terminal
  disputed: [], // Terminal
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
