-- Work Details: one overall discount for the whole work batch, applied on top
-- of the per-line discounts. Stored on every line so the payment page can
-- reproduce the drawer's grand total without a separate batch table.
ALTER TABLE "client_records" ADD COLUMN IF NOT EXISTS "overall_discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL;
