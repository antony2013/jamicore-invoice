import { splitPaymentTerms } from "@/lib/client-profile";

/** Payment terms expressed in milliseconds (calendar approximations). */
export function paymentTermsMs(terms?: string | null): number | null {
  const { select, rows } = splitPaymentTerms(terms);
  if (select === "before_work" || select === "after_completion") return 0;
  const fixed: Record<string, number> = {
    "10_days_after_approval": 10,
    "15_days": 15,
    "30_days": 30,
  };
  if (select in fixed) return fixed[select] * 86_400_000;

  const day = 86_400_000;
  let ms = 0;
  let found = false;
  for (const row of rows) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    found = true;
    switch (row.unit) {
      case "hours": ms += amount * 3_600_000; break;
      case "days": ms += amount * day; break;
      case "weeks": ms += amount * 7 * day; break;
      case "months": ms += amount * 30 * day; break;
      case "years": ms += amount * 365 * day; break;
    }
  }
  return found ? ms : null;
}

/** Due date from the newest work item's date plus the client's payment terms. */
export function computeDueDate(
  workDate: string | null | undefined,
  fallbackDate: string | Date | null | undefined,
  terms?: string | null
): Date | null {
  const duration = paymentTermsMs(terms);
  if (duration === null) return null;
  const base = workDate
    ? new Date(workDate)
    : fallbackDate
      ? new Date(fallbackDate)
      : null;
  if (!base || Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + duration);
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
