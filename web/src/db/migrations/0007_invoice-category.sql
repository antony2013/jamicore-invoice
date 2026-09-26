ALTER TABLE "invoices" ADD COLUMN "category" text DEFAULT 'sales_invoice' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "category_detail" text;