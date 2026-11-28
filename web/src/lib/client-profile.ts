// Shared vocabularies for the admin client-management profile fields.
// Kept in one place so the create/edit API and both admin screens agree.

export const BUSINESS_TYPES = ["company", "individual", "partnership", "other"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const CLIENT_STATUSES = ["active", "inactive", "suspended"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const BILLING_TYPES = [
  "monthly",
  "one_time",
  "advance_6_months",
  "advance_1_year",
  "hourly",
  "per_task",
  "custom",
] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

export const PRIMARY_SERVICES = [
  "administration",
  "accounting_support",
  "documentation",
  "data_entry",
  "other",
] as const;
export type PrimaryService = (typeof PRIMARY_SERVICES)[number];

export const PAYMENT_TERMS = [
  "10_days_after_approval",
  "15_days",
  "30_days",
  "before_work",
  "after_completion",
  "custom",
] as const;

export const BUSINESS_TYPE_LABELS: Record<string, string> = {
  company: "Company",
  individual: "Individual",
  partnership: "Partnership",
  other: "Other",
};

export const CLIENT_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
};

export const BILLING_TYPE_LABELS: Record<string, string> = {
  monthly: "Monthly",
  one_time: "One-Time",
  advance_6_months: "Advance - 6 Months",
  advance_1_year: "Advance - 1 Year",
  hourly: "Hourly",
  per_task: "Per Task",
  custom: "Custom",
};

export const PRIMARY_SERVICE_LABELS: Record<string, string> = {
  administration: "Administration",
  accounting_support: "Accounting Support",
  documentation: "Documentation",
  data_entry: "Data Entry",
  other: "Other",
};

export const PAYMENT_TERMS_LABELS: Record<string, string> = {
  "10_days_after_approval": "10 Days After Approval",
  "15_days": "15 Days",
  "30_days": "30 Days",
  before_work: "Before Work",
  after_completion: "After Completion",
  custom: "Custom",
};

// "Custom" stores the manually picked cycle (e.g. "6 months 5 days").
// These helpers split a stored value into the dropdown choice + amount/unit rows,
// and resolve the rows back into the value saved on the client.

export const CUSTOM_CYCLE_UNITS = ["hours", "days", "weeks", "months", "years"] as const;

export const CUSTOM_CYCLE_UNIT_LABELS: Record<string, string> = {
  hours: "Hours",
  days: "Days",
  weeks: "Weeks",
  months: "Months",
  years: "Years",
};

export type CustomCycleRow = { amount: string; unit: string };

// One or more "6 months 5 days" style segments, commas optional.
const CYCLE_PATTERN = /^(?:\d+(?:\.\d+)?\s*(?:hour|day|week|month|year)s?\s*,?\s*)+$/i;
const CYCLE_SEGMENT = /(\d+(?:\.\d+)?)\s*(hour|day|week|month|year)s?/gi;

export function splitCustomCycle(value?: string | null): CustomCycleRow[] {
  const text = value?.trim();
  if (!text || !CYCLE_PATTERN.test(text)) return [];
  const rows: CustomCycleRow[] = [];
  for (const match of text.matchAll(CYCLE_SEGMENT)) {
    rows.push({ amount: match[1], unit: `${match[2].toLowerCase()}s` });
  }
  return rows;
}

function joinCycle(rows: CustomCycleRow[]): string {
  const parts = rows
    .map(({ amount, unit }) => {
      const trimmed = amount.trim();
      const numeric = Number(trimmed);
      if (!trimmed || !Number.isFinite(numeric) || numeric <= 0) return null;
      const safeUnit = (CUSTOM_CYCLE_UNITS as readonly string[]).includes(unit) ? unit : "months";
      return `${trimmed} ${numeric === 1 ? safeUnit.replace(/s$/, "") : safeUnit}`;
    })
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" ") : "custom";
}

export function splitBillingType(value?: string | null): { select: string; rows: CustomCycleRow[] } {
  if (!value || (BILLING_TYPES as readonly string[]).includes(value)) {
    return { select: value || "monthly", rows: [] };
  }
  return { select: "custom", rows: splitCustomCycle(value) };
}

// A custom payment term is stored as `custom:<days>|<url-encoded name>`, e.g.
// `custom:45|Net%2045`. The name is free text, so encode it before storing.
const CUSTOM_TERM_PREFIX = "custom:";

export function splitPaymentTerms(value?: string | null): {
  select: string;
  rows: CustomCycleRow[];
  name?: string;
} {
  const text = value?.trim();
  if (text?.startsWith(CUSTOM_TERM_PREFIX)) {
    const raw = text.slice(CUSTOM_TERM_PREFIX.length);
    const cut = raw.indexOf("|");
    const days = Number(cut >= 0 ? raw.slice(0, cut) : raw);
    let name = "";
    if (cut >= 0) {
      try {
        name = decodeURIComponent(raw.slice(cut + 1));
      } catch {
        name = raw.slice(cut + 1);
      }
    }
    const safeDays = Number.isFinite(days) && days > 0 ? days : 0;
    return {
      select: "custom",
      rows: safeDays ? [{ amount: String(safeDays), unit: "days" }] : [],
      name,
    };
  }
  if (!text || (PAYMENT_TERMS as readonly string[]).includes(text)) {
    return { select: text || "10_days_after_approval", rows: [] };
  }
  return { select: "custom", rows: splitCustomCycle(value) };
}

export function resolveBillingType(select: string, rows: CustomCycleRow[]): string {
  return select === "custom" ? joinCycle(rows) : select;
}

export function resolvePaymentTerms(
  select: string,
  rows: CustomCycleRow[],
  name?: string
): string {
  if (select !== "custom") return select;
  const raw = rows.find((row) => row.unit === "days")?.amount ?? rows[0]?.amount;
  const days = Number(raw);
  const safeDays = Number.isFinite(days) && days > 0 ? days : 0;
  const cleanName = (name || "").trim() || "Custom";
  return `${CUSTOM_TERM_PREFIX}${safeDays}|${encodeURIComponent(cleanName)}`;
}

/** Human-readable payment term for tables and detail views. */
export function formatPaymentTerms(value?: string | null): string {
  const { select, rows, name } = splitPaymentTerms(value);
  if (select !== "custom") return PAYMENT_TERMS_LABELS[select] ?? value ?? "—";
  const label = (name || "").trim() || "Custom";
  const days = Number(rows.find((row) => row.unit === "days")?.amount ?? 0);
  return days > 0 ? `${label} · ${days} days` : label;
}
