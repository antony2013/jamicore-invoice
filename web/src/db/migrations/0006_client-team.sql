CREATE TABLE "client_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"pin_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_staff_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "uploaded_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "client_staff" ADD CONSTRAINT "client_staff_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_uploaded_by_staff_id_client_staff_id_fk" FOREIGN KEY ("uploaded_by_staff_id") REFERENCES "public"."client_staff"("id") ON DELETE set null ON UPDATE no action;