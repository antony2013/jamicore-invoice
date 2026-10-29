ALTER TABLE "invoice_reports" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_reports" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "invoice_reports" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "invoice_reports" ADD CONSTRAINT "invoice_reports_deleted_by_staff_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_reports_deleted_idx" ON "invoice_reports" USING btree ("deleted_at");