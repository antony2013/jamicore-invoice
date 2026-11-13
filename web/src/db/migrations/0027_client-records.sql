-- Client-scoped generic records for the admin client profile:
-- services, tasks, documents, billing, payments, meetings, notifications.
CREATE TABLE IF NOT EXISTS "client_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"amount" numeric(12, 3) DEFAULT '0' NOT NULL,
	"record_date" date,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_to" text,
	"description" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_records" ADD CONSTRAINT "client_records_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_records_client_type_idx" ON "client_records" USING btree ("client_id","type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_records_date_idx" ON "client_records" USING btree ("record_date");
