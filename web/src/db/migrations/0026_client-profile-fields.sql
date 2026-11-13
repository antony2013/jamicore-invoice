-- Client management profile fields (admin-only business details).
-- Login state remains on archived_at; `status` is the business status.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "contact_person" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "business_type" text DEFAULT 'company' NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "registration_number" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "primary_service" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "service_start_date" date;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "billing_type" text DEFAULT 'monthly' NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "base_fee" numeric(12, 3) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "payment_terms" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "extra_work_allowed" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "internal_notes" text;
