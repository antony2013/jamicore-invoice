CREATE TABLE "invoice_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"sender_type" text NOT NULL,
	"sender_id" text NOT NULL,
	"sender_name" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text NOT NULL,
	"is_read_by_staff" boolean DEFAULT false NOT NULL,
	"is_read_by_client" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"s3_key" text NOT NULL,
	"file_name" text NOT NULL,
	"source" text DEFAULT 'uploaded' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_reports_s3_key_unique" UNIQUE("s3_key")
);
--> statement-breakpoint
ALTER TABLE "invoice_messages" ADD CONSTRAINT "invoice_messages_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_reports" ADD CONSTRAINT "invoice_reports_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_reports" ADD CONSTRAINT "invoice_reports_uploaded_by_staff_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;