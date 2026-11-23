-- Per-client automatic payment reminders (sent N days before the due date).
CREATE TABLE IF NOT EXISTS "client_payment_reminders" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "client_id" uuid NOT NULL REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action,
  "enabled" boolean DEFAULT true NOT NULL,
  "days_before" integer DEFAULT 3 NOT NULL,
  "last_sent_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_payment_reminders_client_idx" ON "client_payment_reminders" USING btree ("client_id");
