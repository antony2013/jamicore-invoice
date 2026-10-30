import { index, pgTable, text, timestamp, unique, uuid, integer, jsonb, boolean, pgEnum, primaryKey } from "drizzle-orm/pg-core";
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
// contact info only. Very old rows (pre-password era) may have null
// username/password.
export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  username: text("username").unique(),
  passwordHash: text("password_hash"),
  phone: text("phone").unique(),
  email: text("email").unique(),
  // Business address printed/kept on the client account (admin-maintained,
  // optional). Outlets carry their own address for branch-level detail.
  address: text("address"),
  // Default staff for this client: ALL of their invoices (current backlog
  // via bulk-assign, new ones via default-staff auto-assign at upload) route
  // to this person. Null = manual assignment per invoice.
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
export const clientStaff = pgTable(
  "client_staff",
  {
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
  },
  (t) => [index("client_staff_client_idx").on(t.clientId)]
);

// 2. Outlets Table — a client may own multiple shops/branches.
// Invoices optionally point at the outlet they came from (null = Unspecified,
// e.g. legacy rows from before outlets existed).
export const outlets = pgTable(
  "outlets",
  {
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
  },
  (t) => [index("outlets_client_idx").on(t.clientId)]
);

// 2c. Outlet Staff — which staff members work an outlet (many-to-many).
// Independent of outlets.assignedStaffId, which stays the single "default
// staff" used for upload auto-routing.
export const outletStaff = pgTable(
  "outlet_staff",
  {
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.outletId, t.staffId] }),
    index("outlet_staff_staff_idx").on(t.staffId),
  ]
);

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
export const invoices = pgTable(
  "invoices",
  {
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
  // Job number + completion date: assigned automatically when the invoice is
  // moved to `collected` (JC-YYYYMMDD-0001, daily sequence). Unique so two
  // concurrent completes can never share a number.
  jobNumber: text("job_number").unique(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // Soft delete (Phase 2.2): rows are never hard-deleted via API. Queries
  // must exclude deleted rows (see `notDeleted` in lib/invoice-access).
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  deleteReason: text("delete_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("invoices_status_created_idx").on(t.status, t.createdAt.desc()),
    index("invoices_assigned_status_idx").on(t.assignedTo, t.status),
    index("invoices_client_created_idx").on(t.clientId, t.createdAt.desc()),
    index("invoices_outlet_idx").on(t.outletId),
    index("invoices_deleted_idx").on(t.deletedAt),
  ]
);

// 5. Assignments Table
export const assignments = pgTable(
  "assignments",
  {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  staffId: uuid("staff_id").references(() => staff.id).notNull(),
  assignedBy: uuid("assigned_by").references(() => staff.id).notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("assignments_invoice_idx").on(t.invoiceId)]
);

// 6. Invoice Status Log (Audit Trail)
export const invoiceStatusLog = pgTable(
  "invoice_status_log",
  {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  status: invoiceStatusEnum("status").notNull(),
  changedBy: uuid("changed_by").references(() => staff.id), // Nullable: null means system/automated e.g. OCR worker
  note: text("note"),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("invoice_status_log_invoice_idx").on(t.invoiceId, t.timestamp.desc())]
);

// 6b. Append-only audit log (Phase 2.2): who did what, with before/after.
// Deliberately NO foreign keys and NO cascade — history must survive the
// rows it describes. NOTHING in the codebase may UPDATE or DELETE these rows.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    actorType: text("actor_type").notNull(), // 'staff' | 'client' | 'client_staff' | 'system'
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    meta: jsonb("meta"),
    ip: text("ip"),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId, t.at.desc()),
    index("audit_log_at_idx").on(t.at.desc()),
  ]
);

// 7. Invoice Reports — Excel work products the OFFICE STAFF produce per
// invoice (generated from the invoice, or a custom .xlsx upload). The CLIENT
// downloads the latest report from the mobile app.
export const invoiceReports = pgTable(
  "invoice_reports",
  {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  // S3 key of the .xlsx file (reports/<invoiceId>/<file>)
  s3Key: text("s3_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  // Note typed by office staff while uploading (shown to the client app)
  notes: text("notes"),
  // "generated" = built by the server from invoice data; "uploaded" = staff file
  source: text("source").notNull().default("uploaded"),
  uploadedBy: uuid("uploaded_by").references(() => staff.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // Soft delete ("Trash"): the row + S3 object stay so it can be restored.
  // deleteReason is the staff/admin remark ("why was this deleted").
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: uuid("deleted_by").references(() => staff.id),
  deleteReason: text("delete_reason"),
  },
  (t) => [
    index("invoice_reports_invoice_idx").on(t.invoiceId, t.createdAt.desc()),
    index("invoice_reports_deleted_idx").on(t.deletedAt),
  ]
);

// 8. Invoice Messages — the client↔staff conversation thread per invoice.
// senderType "staff" = office staff/admin; "client" = owner OR team member
// (senderName snapshots who wrote it). kind "request_report" = the client
// asking for a particular report. Read flags drive "new message" dots.
export const invoiceMessages = pgTable(
  "invoice_messages",
  {
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
  },
  (t) => [
    index("invoice_messages_invoice_idx").on(t.invoiceId, t.createdAt),
    index("invoice_messages_unread_idx").on(t.invoiceId, t.isReadByClient),
  ]
);

// 8b. Message Drafts — unsent office replies, one per staff member + invoice.
// Drafts never leave the office; sending posts to the invoice thread.
export const messageDrafts = pgTable(
  "message_drafts",
  {
  id: uuid("id").defaultRandom().primaryKey(),
  staffId: uuid("staff_id").references(() => staff.id, { onDelete: "cascade" }).notNull(),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  body: text("body").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("message_drafts_staff_idx").on(t.staffId),
    unique("message_drafts_staff_invoice_uniq").on(t.staffId, t.invoiceId),
  ]
);

export const notificationDismissals = pgTable(
  "notification_dismissals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "cascade" }).notNull(),
    notificationKey: text("notification_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("notification_dismissals_staff_idx").on(t.staffId),
    unique("notification_dismissals_staff_key_uniq").on(t.staffId, t.notificationKey),
  ]
);

// 8c. Assistant Chat — scoped staff↔bot conversation per outlet or invoice.
// scopeId is text so the synthetic "none" outlet group is addressable too.
// Attachments live in S3 under chat/<uuid>-<name>; the row keeps key + name.
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scopeType: text("scope_type").notNull(), // "outlet" | "invoice"
    scopeId: text("scope_id").notNull(),
    senderType: text("sender_type").notNull(), // "staff" | "bot"
    senderId: text("sender_id").notNull(), // staff uuid | "bot"
    body: text("body"),
    attachmentS3Key: text("attachment_s3_key"),
    attachmentName: text("attachment_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("chat_messages_scope_idx").on(t.scopeType, t.scopeId, t.createdAt)]
);

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
  staffMembers: many(outletStaff),
}));

export const outletStaffRelations = relations(outletStaff, ({ one }) => ({
  outlet: one(outlets, {
    fields: [outletStaff.outletId],
    references: [outlets.id],
  }),
  staff: one(staff, {
    fields: [outletStaff.staffId],
    references: [staff.id],
  }),
}));

export const staffRelations = relations(staff, ({ many }) => ({
  assignedInvoices: many(invoices),
  assignmentsGiven: many(assignments, { relationName: "assigner" }),
  assignmentsReceived: many(assignments, { relationName: "assignee" }),
  statusLogs: many(invoiceStatusLog),
  outletMemberships: many(outletStaff),
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

export const messageDraftsRelations = relations(messageDrafts, ({ one }) => ({
  invoice: one(invoices, {
    fields: [messageDrafts.invoiceId],
    references: [invoices.id],
  }),
}));
