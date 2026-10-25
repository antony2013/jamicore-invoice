CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"sender_type" text NOT NULL,
	"sender_id" text NOT NULL,
	"body" text,
	"attachment_s3_key" text,
	"attachment_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_messages_scope_idx" ON "chat_messages" USING btree ("scope_type","scope_id","created_at");