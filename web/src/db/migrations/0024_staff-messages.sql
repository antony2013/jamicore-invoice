-- Internal office notes addressed to a staff member (Compose "To: Staff").
-- Staff↔staff only: these rows never appear in a client invoice thread.
CREATE TABLE "staff_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"body" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_messages" ADD CONSTRAINT "staff_messages_sender_id_staff_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_messages" ADD CONSTRAINT "staff_messages_recipient_id_staff_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "staff_messages_recipient_idx" ON "staff_messages" USING btree ("recipient_id","created_at");
--> statement-breakpoint
CREATE INDEX "staff_messages_sender_idx" ON "staff_messages" USING btree ("sender_id","created_at");
