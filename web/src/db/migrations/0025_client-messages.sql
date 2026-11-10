-- General office <-> client messages (Compose "To: Client"), independent of
-- any invoice. Invoice-scoped conversations stay in invoice_messages.
CREATE TABLE "client_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"sender_type" text DEFAULT 'staff' NOT NULL,
	"sender_id" text NOT NULL,
	"sender_name" text NOT NULL,
	"body" text NOT NULL,
	"is_read_by_staff" boolean DEFAULT false NOT NULL,
	"is_read_by_client" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "client_messages_client_idx" ON "client_messages" USING btree ("client_id","created_at");
--> statement-breakpoint
CREATE INDEX "client_messages_sender_idx" ON "client_messages" USING btree ("sender_type","created_at");
