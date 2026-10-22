CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_time_order_chk" CHECK ("ends_at" > "starts_at");
--> statement-breakpoint
-- A tutor cannot have two overlapping active bookings (hold / pending_payment / confirmed).
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap_excl"
  EXCLUDE USING gist ("tutor_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE (status IN ('hold', 'pending_payment', 'confirmed'));
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_chk" CHECK ("rating" BETWEEN 1 AND 5);
--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_price_chk" CHECK ("price_ngn" >= 0);
--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_duration_chk" CHECK ("duration_minutes" BETWEEN 30 AND 480);
--> statement-breakpoint
ALTER TABLE "tutor_availability" ADD CONSTRAINT "availability_window_chk" CHECK ("weekday" BETWEEN 0 AND 6 AND "start_minute" >= 0 AND "end_minute" <= 1440 AND "end_minute" > "start_minute");
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_money_chk" CHECK ("price_ngn" >= 0 AND "credit_applied_ngn" >= 0 AND "amount_due_ngn" >= 0 AND "commission_ngn" >= 0 AND "tutor_earning_ngn" >= 0);
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD CONSTRAINT "plans_commission_chk" CHECK ("commission_pct" BETWEEN 0 AND 100);
