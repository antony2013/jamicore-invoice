ALTER TABLE "otp_codes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "otp_codes" CASCADE;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_username_unique" UNIQUE("username");