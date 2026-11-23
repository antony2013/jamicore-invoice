-- Work Details side panel on the client page: per-line quantity, rate,
-- discount and tax so the saved service rows can reproduce the panel totals.
ALTER TABLE "client_records" ADD COLUMN IF NOT EXISTS "work_category" text;
--> statement-breakpoint
ALTER TABLE "client_records" ADD COLUMN IF NOT EXISTS "quantity" numeric(12, 3) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "client_records" ADD COLUMN IF NOT EXISTS "rate" numeric(12, 3) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "client_records" ADD COLUMN IF NOT EXISTS "discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "client_records" ADD COLUMN IF NOT EXISTS "tax_percent" numeric(5, 2) DEFAULT '5' NOT NULL;
