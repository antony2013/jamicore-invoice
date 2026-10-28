ALTER TABLE "invoices" ADD COLUMN "job_number" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_number_unique" UNIQUE("job_number");