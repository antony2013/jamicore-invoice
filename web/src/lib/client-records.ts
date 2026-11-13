// Client-scoped record types used by the admin client profile.
// These are admin bookkeeping entries; invoices, reports and messages keep
// their own dedicated modules.

export const CLIENT_RECORD_TYPES = [
  "service",
  "task",
  "document",
  "billing",
  "payment",
  "meeting",
  "notification",
] as const;
export type ClientRecordType = (typeof CLIENT_RECORD_TYPES)[number];

export const CLIENT_RECORD_STATUSES = [
  "pending",
  "active",
  "paid",
  "completed",
  "overdue",
  "cancelled",
] as const;
export type ClientRecordStatus = (typeof CLIENT_RECORD_STATUSES)[number];

export const CLIENT_RECORD_TYPE_LABELS: Record<string, string> = {
  service: "Service",
  task: "Task",
  document: "Document",
  billing: "Billing",
  payment: "Payment",
  meeting: "Meeting",
  notification: "Notification",
};

export const CLIENT_RECORD_TYPE_PLURALS: Record<string, string> = {
  service: "Services",
  task: "Tasks",
  document: "Documents",
  billing: "Billing",
  payment: "Payments",
  meeting: "Meetings",
  notification: "Notifications",
};

export const CLIENT_RECORD_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  active: "Active",
  paid: "Paid",
  completed: "Completed",
  overdue: "Overdue",
  cancelled: "Cancelled",
};
