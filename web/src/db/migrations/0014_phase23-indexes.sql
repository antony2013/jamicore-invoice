CREATE INDEX "assignments_invoice_idx" ON "assignments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "client_staff_client_idx" ON "client_staff" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoice_messages_invoice_idx" ON "invoice_messages" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "invoice_messages_unread_idx" ON "invoice_messages" USING btree ("invoice_id","is_read_by_client");--> statement-breakpoint
CREATE INDEX "invoice_reports_invoice_idx" ON "invoice_reports" USING btree ("invoice_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invoice_status_log_invoice_idx" ON "invoice_status_log" USING btree ("invoice_id","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invoices_status_created_idx" ON "invoices" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invoices_assigned_status_idx" ON "invoices" USING btree ("assigned_to","status");--> statement-breakpoint
CREATE INDEX "invoices_client_created_idx" ON "invoices" USING btree ("client_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invoices_outlet_idx" ON "invoices" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX "invoices_deleted_idx" ON "invoices" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "outlets_client_idx" ON "outlets" USING btree ("client_id");