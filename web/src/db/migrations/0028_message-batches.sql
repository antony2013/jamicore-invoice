-- Compose batches: one send shares a batch id across all of its recipients.
-- Existing rows keep their own unique batch (volatile default fills per row).
ALTER TABLE "client_messages" ADD COLUMN IF NOT EXISTS "batch_id" uuid DEFAULT gen_random_uuid() NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_messages" ADD COLUMN IF NOT EXISTS "batch_id" uuid DEFAULT gen_random_uuid() NOT NULL;
--> statement-breakpoint

-- Staff inbox rows can now be copies of a staff -> client message.
ALTER TABLE "staff_messages" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'direct' NOT NULL;
--> statement-breakpoint
ALTER TABLE "staff_messages" ADD COLUMN IF NOT EXISTS "client_id" uuid;
--> statement-breakpoint
ALTER TABLE "staff_messages" ADD CONSTRAINT "staff_messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Legacy admin -> client copies were stored with this body prefix.
UPDATE "staff_messages"
SET "source" = 'client_copy'
WHERE "body" LIKE 'Client message %';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "client_messages_batch_idx" ON "client_messages" USING btree ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_messages_batch_idx" ON "staff_messages" USING btree ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_messages_client_idx" ON "staff_messages" USING btree ("client_id");
