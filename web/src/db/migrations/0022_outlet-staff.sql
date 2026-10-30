CREATE TABLE "outlet_staff" (
	"outlet_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	CONSTRAINT "outlet_staff_outlet_id_staff_id_pk" PRIMARY KEY("outlet_id","staff_id")
);
--> statement-breakpoint
ALTER TABLE "outlet_staff" ADD CONSTRAINT "outlet_staff_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_staff" ADD CONSTRAINT "outlet_staff_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outlet_staff_staff_idx" ON "outlet_staff" USING btree ("staff_id");