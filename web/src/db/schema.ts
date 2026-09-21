import { pgTable, text, timestamp, uuid, integer, jsonb, pgEnum } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 3. Staff Table (Admin and Staff web users)
export const staff = pgTable("staff", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: roleEnum("role").notNull().default("staff"),
  passwordHash: text("password_hash").notNull(),
  // Last activity heartbeat (page navs + key API calls). Online = < 5 min.
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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

// Relations
export const clientsRelations = relations(clients, ({ many, one }) => ({
  invoices: many(invoices),
  outlets: many(outlets),
  assignedStaff: one(staff, {
    fields: [clients.assignedStaffId],
    references: [staff.id],
  }),
}));

export const outletsRelations = relations(outlets, ({ one, many }) => ({
  client: one(clients, {
    fields: [outlets.clientId],
    references: [clients.id],
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
  assignments: many(assignments),
  statusLogs: many(invoiceStatusLog),
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
