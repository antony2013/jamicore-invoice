import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assignments } from "@/db/schema";

/**
 * Single source of truth for CLIENT self-service edit/withdraw rules
 * (mobile owner + team staff; office rules live in status-flow.ts).
 *
 * Editable while pre-assignment (uploaded / ocr_pending / ocr_done /
 * ocr_failed) — plus `assigned` rows that were AUTO-assigned and never
 * manually touched (no row in `assignments`, i.e. no admin hand involved).
 * This keeps the 1-hour uploader window meaningful even when a client
 * default staff auto-assigns at upload time.
 *
 * Withdraw additionally requires the 1-hour window from upload.
 */
export const PRE_ASSIGNMENT_STATUSES = [
  "uploaded",
  "ocr_pending",
  "ocr_done",
  "ocr_failed",
] as const;

export const DELETE_WINDOW_MS = 60 * 60 * 1000; // 1 hour from upload

export async function hasManualAssignment(invoiceId: string): Promise<boolean> {
  const row = await db.query.assignments.findFirst({
    where: eq(assignments.invoiceId, invoiceId),
    columns: { id: true },
  });
  return !!row;
}

export function isClientEditable(status: string, manualAssignment: boolean): boolean {
  if ((PRE_ASSIGNMENT_STATUSES as readonly string[]).includes(status)) return true;
  return status === "assigned" && !manualAssignment;
}

export function isClientWithdrawable(
  status: string,
  manualAssignment: boolean,
  createdAt: Date | string
): boolean {
  if (!isClientEditable(status, manualAssignment)) return false;
  return Date.now() - new Date(createdAt).getTime() <= DELETE_WINDOW_MS;
}
