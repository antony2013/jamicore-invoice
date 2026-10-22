CREATE TABLE "notification_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"notification_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_dismissals_staff_key_uniq" UNIQUE("staff_id","notification_key")
);
--> statement-breakpoint
ALTER TABLE "notification_dismissals" ADD CONSTRAINT "notification_dismissals_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_dismissals_staff_idx" ON "notification_dismissals" USING btree ("staff_id");