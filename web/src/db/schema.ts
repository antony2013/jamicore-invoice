import { pgTable, text, timestamp, uuid, integer, jsonb, boolean, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums
export const roleEnum = pgEnum("staff_role", ["admin", "staff"]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "uploaded",
  "ocr_pending",
  "ocr_done",
  "ocr_failed",
  "assigned",
  "in_review",
  "needs_info",
  "verified",
  "collected",
  "disputed",
]);

export const priorityEnum = pgEnum("invoice_priority", ["low", "normal", "urgent"]);

// 1. Clients Table (Mobile App Users)
// Identity: admin-created username + password (bcrypt). Phone/email are
// contact info only. Legacy OTP-era rows may have null username/password.
export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  username: text("username").unique(),
  passwordHash: text("password_hash"),
  phone: text("phone").unique(),
  email: text("email").unique(),
  // Default staff for this client: ALL of their invoices (current backlog
  // via bulk-assign, new ones via OCR auto-assign) route to this person.
  // Null = manual assignment per invoice.
  assignedStaffId: uuid("assigned_staff_id").references(() => staff.id, { onDelete: "set null" }),
  // Session revocation counter — password reset or archive bumps it.
  tokenVersion: integer("token_version").notNull().default(0),
  // Soft archive: archived clients cannot log in and their tokens die.
  // (Hard delete is only allowed when the client has zero invoices.)
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 2b. Client Staff Table — shop workers created by the CLIENT OWNER inside
// the mobile app (Team screen). They sign in with user ID + short PIN
// (bcrypt-hashed) and upload files on behalf of the client. Deactivation
// (isActive=false) blocks login but preserves upload attribution.
export const clientStaff = pgTable("client_staff", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  pinHash: text("pin_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  // Session revocation counter — every PIN change/deactivation bumps it;
  // mobile JWTs carrying an older tv are rejected.
  tokenVersion: integer("token_version").notNull().default(0),
  // Which outlet/branch this member works at (null = all/unspecified).
  // Plain uuid WITHOUT an FK (a two-way FK with outlets.createdByStaffId
  // would be a circular reference breaking type inference). Ownership is
  // validated in the API; outlet deletion nulls this out explicitly.
  outletId: uuid("outlet_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 2. Outlets Table — a client may own multiple shops/branches.
// Invoices optionally point at the outlet they came from (null = Unspecified,
// e.g. legacy rows from before outlets existed).
export const outlets = pgTable("outlets", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  // Which team staff member added this outlet (null = office/admin or owner).
  // Shown in lists so everyone knows who created which branch.
  createdByStaffId: uuid("created_by_staff_id").references(() => clientStaff.id, { onDelete: "set null" }),
  // Default staff for THIS outlet (overrides the client-level default on
  // uploads tagged with this outlet). Null = fall back to client default.
  assignedStaffId: uuid("assigned_staff_id").references(() => staff.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 3. Staff Table (Admin and Staff web users)
export const staff = pgTable("staff", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: roleEnum("role").notNull().default("staff"),
  passwordHash: text("password_hash").notNull(),
  // Deactivation blocks login and kills live sessions (see tokenVersion).
  isActive: boolean("is_active").notNull().default(true),
  // Session revocation counter — password reset, deactivation or role
  // change bumps it; JWTs with an older tokenVersion are rejected.
  tokenVersion: integer("token_version").notNull().default(0),
  // Last activity heartbeat (page navs + key API calls). Online = < 5 min.
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 3b. Rate-limit counters (Postgres-backed so limits survive restarts and
// work across processes; one row per key, fixed windows).
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

// 4. Invoices Table
export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").references(() => clients.id).notNull(),
  s3Key: text("s3_key").notNull().unique(),
  imageUrl: text("image_url").notNull(), // Internal reference key/URI, NEVER public
  status: invoiceStatusEnum("status").notNull().default("uploaded"),
  ocrData: jsonb("ocr_data").$type<{
    amount?: number | string | null;
    invoiceNo?: string | null;
    date?: string | null;
    vendor?: string | null;
    rawText?: string | null;
    confidence?: number | null;
    fieldConfidence?: Record<string, number> | null;
  } | null>(),
  ocrRetryCount: integer("ocr_retry_count").notNull().default(0),
  assignedTo: uuid("assigned_to").references(() => staff.id),
  priority: priorityEnum("priority").notNull().default("normal"),
  // Optional note typed by the client on the mobile app at upload time
  clientNote: text("client_note"),
  // Per-page notes (one entry per PDF page, may be empty strings)
  pageNotes: jsonb("page_notes").$type<string[] | null>(),
  // Which outlet of the client this invoice came from (null = Unspecified)
  outletId: uuid("outlet_id").references(() => outlets.id),
  // Main upload category (sales/purchase/expense/asset/other).
  // When 'other', categoryDetail holds the custom text (required).
  category: text("category").notNull().default("sales_invoice"),
  categoryDetail: text("category_detail"),
  // Which client-staff member uploaded (null = client owner themself)
  uploadedByStaffId: uuid("uploaded_by_staff_id").references(() => clientStaff.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 5. Assignments Table
export const assignments = pgTable("assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  staffId: uuid("staff_id").references(() => staff.id).notNull(),
  assignedBy: uuid("assigned_by").references(() => staff.id).notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
});

// 6. Invoice Status Log (Audit Trail)
export const invoiceStatusLog = pgTable("invoice_status_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  status: invoiceStatusEnum("status").notNull(),
  changedBy: uuid("changed_by").references(() => staff.id), // Nullable: null means system/automated e.g. OCR worker
  note: text("note"),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
});

// 7. Invoice Reports — Excel work products the OFFICE STAFF produce per
// invoice (generated from the invoice, or a custom .xlsx upload). The CLIENT
// downloads the latest report from the mobile app.
export const invoiceReports = pgTable("invoice_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  // S3 key of the .xlsx file (reports/<invoiceId>/<file>)
  s3Key: text("s3_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  // "generated" = built by the server from invoice data; "uploaded" = staff file
  source: text("source").notNull().default("uploaded"),
  uploadedBy: uuid("uploaded_by").references(() => staff.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 8. Invoice Messages — the client↔staff conversation thread per invoice.
// senderType "staff" = office staff/admin; "client" = owner OR team member
// (senderName snapshots who wrote it). kind "request_report" = the client
// asking for a particular report. Read flags drive "new message" dots.
export const invoiceMessages = pgTable("invoice_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  senderType: text("sender_type").notNull(), // "staff" | "client"
  senderId: text("sender_id").notNull(),
  senderName: text("sender_name").notNull(),
  kind: text("kind").notNull().default("text"), // "text" | "request_report" | "system"
  body: text("body").notNull(),
  isReadByStaff: boolean("is_read_by_staff").notNull().default(false),
  isReadByClient: boolean("is_read_by_client").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Relations
export const clientsRelations = relations(clients, ({ many, one }) => ({
  invoices: many(invoices),
  outlets: many(outlets),
  team: many(clientStaff),
  assignedStaff: one(staff, {
    fields: [clients.assignedStaffId],
    references: [staff.id],
  }),
}));

export const clientStaffRelations = relations(clientStaff, ({ one, many }) => ({
  client: one(clients, {
    fields: [clientStaff.clientId],
    references: [clients.id],
  }),
  // NOTE: no `outlet` relation here — outlets <-> clientStaff would be a
  // circular relation pair that breaks TS inference. Outlet names for team
  // rows are fetched with a separate query (see GET /api/client-team).
  uploads: many(invoices),
}));

export const outletsRelations = relations(outlets, ({ one, many }) => ({
  client: one(clients, {
    fields: [outlets.clientId],
    references: [clients.id],
  }),
  createdBy: one(clientStaff, {
    fields: [outlets.createdByStaffId],
    references: [clientStaff.id],
  }),
  assignedStaff: one(staff, {
    fields: [outlets.assignedStaffId],
    references: [staff.id],
  }),
  invoices: many(invoices),
}));

export const staffRelations = relations(staff, ({ many }) => ({
  assignedInvoices: many(invoices),
  assignmentsGiven: many(assignments, { relationName: "assigner" }),
  assignmentsReceived: many(assignments, { relationName: "assignee" }),
  statusLogs: many(invoiceStatusLog),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  client: one(clients, {
    fields: [invoices.clientId],
    references: [clients.id],
  }),
  assignedStaff: one(staff, {
    fields: [invoices.assignedTo],
    references: [staff.id],
  }),
  outlet: one(outlets, {
    fields: [invoices.outletId],
    references: [outlets.id],
  }),
  uploadedBy: one(clientStaff, {
    fields: [invoices.uploadedByStaffId],
    references: [clientStaff.id],
  }),
  assignments: many(assignments),
  statusLogs: many(invoiceStatusLog),
  reports: many(invoiceReports),
  messages: many(invoiceMessages),
}));

export const assignmentsRelations = relations(assignments, ({ one }) => ({
  invoice: one(invoices, {
    fields: [assignments.invoiceId],
    references: [invoices.id],
  }),
  staff: one(staff, {
    fields: [assignments.staffId],
    references: [staff.id],
    relationName: "assignee",
  }),
  assigner: one(staff, {
    fields: [assignments.assignedBy],
    references: [staff.id],
    relationName: "assigner",
  }),
}));

export const invoiceStatusLogRelations = relations(invoiceStatusLog, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceStatusLog.invoiceId],
    references: [invoices.id],
  }),
  actor: one(staff, {
    fields: [invoiceStatusLog.changedBy],
    references: [staff.id],
  }),
}));

export const invoiceReportsRelations = relations(invoiceReports, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceReports.invoiceId],
    references: [invoices.id],
  }),
}));

export const invoiceMessagesRelations = relations(invoiceMessages, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceMessages.invoiceId],
    references: [invoices.id],
  }),
}));
