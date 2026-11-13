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
