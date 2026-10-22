CREATE TYPE "public"."academic_level" AS ENUM('primary', 'junior_secondary', 'senior_secondary', 'tertiary', 'adult');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('super', 'moderator', 'finance');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('in_progress', 'submitted', 'expired');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('hold', 'pending_payment', 'confirmed', 'completed', 'cancelled_by_student', 'cancelled_by_tutor', 'no_show_student', 'no_show_tutor', 'disputed', 'refunded', 'expired');--> statement-breakpoint
CREATE TYPE "public"."challenge_status" AS ENUM('draft', 'in_review', 'published', 'rejected', 'archived');--> statement-breakpoint
CREATE TYPE "public"."credit_status" AS ENUM('pending', 'available', 'redeemed', 'reversed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."credit_type" AS ENUM('referral', 'challenge_reward', 'leaderboard_reward', 'promotional', 'redemption', 'reversal', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."cycle_status" AS ENUM('open', 'finalized', 'rewarded');--> statement-breakpoint
CREATE TYPE "public"."engagement_kind" AS ENUM('started', 'completed', 'repeat');--> statement-breakpoint
CREATE TYPE "public"."leaderboard_scope" AS ENUM('nationwide', 'state', 'city', 'subject');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('payment_received', 'processing_fee', 'platform_commission', 'tutor_earning', 'refund', 'payout', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery" AS ENUM('in_app', 'email');--> statement-breakpoint
CREATE TYPE "public"."onboarding_step" AS ENUM('verify_email', 'location', 'role', 'profile', 'complete');--> statement-breakpoint
CREATE TYPE "public"."package_status" AS ENUM('draft', 'published', 'unpublished', 'archived');--> statement-breakpoint
CREATE TYPE "public"."payment_purpose" AS ENUM('booking', 'subscription');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('initiated', 'successful', 'failed', 'cancelled', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('requested', 'approved', 'initiated', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."plan_code" AS ENUM('free', 'premium', 'premium_plus');--> statement-breakpoint
CREATE TYPE "public"."referral_kind" AS ENUM('student', 'tutor');--> statement-breakpoint
CREATE TYPE "public"."referral_milestone" AS ENUM('student_verified', 'student_first_session', 'tutor_paid_upgrade', 'tutor_five_sessions');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('requested', 'approved', 'rejected', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'investigating', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('published', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."reward_kind" AS ENUM('cash', 'credit');--> statement-breakpoint
CREATE TYPE "public"."reward_status" AS ENUM('pending_review', 'approved', 'rejected', 'credited', 'payout_initiated', 'paid', 'failed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."session_format" AS ENUM('physical', 'online');--> statement-breakpoint
CREATE TYPE "public"."subscription_source" AS ENUM('paid', 'promotional', 'admin_grant');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('pending_payment', 'active', 'past_due', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."teaching_format" AS ENUM('physical', 'online', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
CREATE TYPE "public"."verification_state" AS ENUM('not_submitted', 'pending', 'verified', 'rejected', 'needs_info');--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"attempt_no" smallint DEFAULT 1 NOT NULL,
	"status" "attempt_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"max_score" integer DEFAULT 0 NOT NULL,
	"correct_count" smallint DEFAULT 0 NOT NULL,
	"duration_seconds" integer
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_role" varchar(20),
	"action" varchar(80) NOT NULL,
	"target_type" varchar(40),
	"target_id" varchar(64),
	"before" jsonb,
	"after" jsonb,
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"format" "session_format" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'hold' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"price_ngn" numeric(12, 2) NOT NULL,
	"credit_applied_ngn" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_due_ngn" numeric(12, 2) NOT NULL,
	"plan_code_at_booking" "plan_code" NOT NULL,
	"commission_pct" numeric(5, 2) NOT NULL,
	"commission_ngn" numeric(12, 2) NOT NULL,
	"tutor_earning_ngn" numeric(12, 2) NOT NULL,
	"payment_id" uuid,
	"lga_id" integer,
	"city_id" integer,
	"address_note" text,
	"meeting_link" text,
	"student_note" text,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"rescheduled_from_id" uuid,
	"tutor_first_response_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"title" varchar(140) NOT NULL,
	"description" text,
	"subject_id" integer,
	"category" varchar(60) NOT NULL,
	"level" "academic_level",
	"exam_id" integer,
	"scheduled_for" date NOT NULL,
	"time_limit_seconds" integer DEFAULT 600 NOT NULL,
	"max_attempts" smallint DEFAULT 1 NOT NULL,
	"status" "challenge_status" DEFAULT 'draft' NOT NULL,
	"reviewed_by" uuid,
	"review_note" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" serial PRIMARY KEY NOT NULL,
	"lga_id" integer NOT NULL,
	"name" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_ngn" numeric(12, 2) NOT NULL,
	"type" "credit_type" NOT NULL,
	"status" "credit_status" DEFAULT 'available' NOT NULL,
	"source" varchar(60) NOT NULL,
	"reason" text NOT NULL,
	"reference_type" varchar(40),
	"reference_id" uuid,
	"idempotency_key" varchar(160) NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" varchar(60) NOT NULL,
	"run_key" varchar(120) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "engagement_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "engagement_kind" NOT NULL,
	"attempt_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(40) NOT NULL,
	"name" varchar(80) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "exams_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"duration_days" smallint DEFAULT 30 NOT NULL,
	"status" "cycle_status" DEFAULT 'open' NOT NULL,
	"finalized_at" timestamp with time zone,
	"rewarded_at" timestamp with time zone,
	"budget_ngn" numeric(12, 2) DEFAULT '50000' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"scope" "leaderboard_scope" NOT NULL,
	"scope_key" varchar(40) DEFAULT 'all' NOT NULL,
	"user_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"points" integer NOT NULL,
	"correct_count" integer NOT NULL,
	"attempts_count" integer NOT NULL,
	"total_duration_seconds" integer NOT NULL,
	"first_submission_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount_ngn" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"payment_id" uuid,
	"booking_id" uuid,
	"subscription_id" uuid,
	"tutor_id" uuid,
	"user_id" uuid,
	"refund_id" uuid,
	"payout_id" uuid,
	"memo" text,
	"idempotency_key" varchar(160) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lgas" (
	"id" serial PRIMARY KEY NOT NULL,
	"state_id" integer NOT NULL,
	"name" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(60) NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"href" varchar(300),
	"dedupe_key" varchar(160),
	"delivery" "notification_delivery" DEFAULT 'in_app' NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "one_time_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "token_purpose" NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"subject_id" integer NOT NULL,
	"level" "academic_level" NOT NULL,
	"exam_id" integer,
	"format" "teaching_format" NOT NULL,
	"price_ngn" numeric(12, 2) NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"sessions_count" smallint DEFAULT 1 NOT NULL,
	"outcomes" text[] DEFAULT '{}'::text[] NOT NULL,
	"requirements" text,
	"status" "package_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(80) NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "payment_purpose" NOT NULL,
	"booking_id" uuid,
	"subscription_id" uuid,
	"amount_ngn" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"status" "payment_status" DEFAULT 'initiated' NOT NULL,
	"provider" varchar(20) DEFAULT 'flutterwave' NOT NULL,
	"provider_tx_id" varchar(40),
	"provider_ref" varchar(80),
	"provider_fee_ngn" numeric(12, 2),
	"checkout_url" text,
	"verified_at" timestamp with time zone,
	"verification_payload" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"amount_ngn" numeric(12, 2) NOT NULL,
	"status" "payout_status" DEFAULT 'requested' NOT NULL,
	"reference" varchar(80) NOT NULL,
	"approved_by" uuid,
	"provider_ref" varchar(80),
	"provider_payload" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"type" varchar(20) DEFAULT 'multiple_choice' NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_key" varchar(8) NOT NULL,
	"explanation" text,
	"points" smallint DEFAULT 10 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" varchar(160) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referral_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_id" uuid NOT NULL,
	"milestone" "referral_milestone" NOT NULL,
	"credit_entry_id" uuid,
	"amount_ngn" numeric(12, 2) NOT NULL,
	"trigger_type" varchar(40),
	"trigger_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referred_user_id" uuid NOT NULL,
	"kind" "referral_kind" NOT NULL,
	"signup_ip" varchar(64),
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"booking_id" uuid,
	"requested_by" uuid NOT NULL,
	"amount_ngn" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" "refund_status" DEFAULT 'requested' NOT NULL,
	"reviewed_by" uuid,
	"review_note" text,
	"provider_ref" varchar(80),
	"provider_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" varchar(30) NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" varchar(60) NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"handled_by" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"status" "review_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "states" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"code" varchar(4) NOT NULL,
	CONSTRAINT "states_name_unique" UNIQUE("name"),
	CONSTRAINT "states_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "student_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"kind" "reward_kind" NOT NULL,
	"amount_ngn" numeric(12, 2) NOT NULL,
	"eligibility_note" text,
	"status" "reward_status" DEFAULT 'pending_review' NOT NULL,
	"reviewed_by" uuid,
	"review_note" text,
	"credit_entry_id" uuid,
	"payout_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(100) NOT NULL,
	"category" varchar(60) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "subjects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"code" "plan_code" PRIMARY KEY NOT NULL,
	"name" varchar(40) NOT NULL,
	"monthly_fee_ngn" numeric(12, 2) NOT NULL,
	"commission_pct" numeric(5, 2) NOT NULL,
	"max_published_packages" integer,
	"visibility_boost" numeric(4, 2) DEFAULT '0' NOT NULL,
	"profile_boost_eligible" boolean DEFAULT false NOT NULL,
	"analytics_tools" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"plan_code" "plan_code" NOT NULL,
	"status" "subscription_status" DEFAULT 'pending_payment' NOT NULL,
	"source" "subscription_source" DEFAULT 'paid' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"payment_id" uuid,
	"grant_reason" text,
	"idempotency_key" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_availability" (
	"id" serial PRIMARY KEY NOT NULL,
	"tutor_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"format" "teaching_format" DEFAULT 'hybrid' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_bank_accounts" (
	"tutor_id" uuid PRIMARY KEY NOT NULL,
	"bank_code" varchar(10) NOT NULL,
	"bank_name" varchar(80) NOT NULL,
	"account_number_enc" text NOT NULL,
	"account_last4" varchar(4) NOT NULL,
	"account_name" varchar(120) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_exams" (
	"tutor_id" uuid NOT NULL,
	"exam_id" integer NOT NULL,
	CONSTRAINT "tutor_exams_tutor_id_exam_id_pk" PRIMARY KEY("tutor_id","exam_id")
);
--> statement-breakpoint
CREATE TABLE "tutor_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"headline" varchar(120),
	"bio" text,
	"years_experience" smallint DEFAULT 0 NOT NULL,
	"offers_physical" boolean DEFAULT false NOT NULL,
	"offers_online" boolean DEFAULT true NOT NULL,
	"identity_status" "verification_state" DEFAULT 'not_submitted' NOT NULL,
	"identity_document_type" varchar(40),
	"identity_document_ref" text,
	"identity_review_note" text,
	"qualification_status" "verification_state" DEFAULT 'not_submitted' NOT NULL,
	"qualification_review_note" text,
	"is_listed" boolean DEFAULT false NOT NULL,
	"rating_avg" numeric(4, 2) DEFAULT '0' NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"completed_sessions" integer DEFAULT 0 NOT NULL,
	"cancelled_by_tutor" integer DEFAULT 0 NOT NULL,
	"repeat_students" integer DEFAULT 0 NOT NULL,
	"avg_response_seconds" integer,
	"rank_score" numeric(8, 4) DEFAULT '0' NOT NULL,
	"rank_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tutor_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"institution" varchar(160) NOT NULL,
	"year_obtained" smallint,
	"document_ref" text,
	"status" "verification_state" DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"tutor_id" uuid NOT NULL,
	"from_plan" "plan_code" NOT NULL,
	"granted_plan" "plan_code" NOT NULL,
	"engagement_score" numeric(10, 2) NOT NULL,
	"status" "reward_status" DEFAULT 'pending_review' NOT NULL,
	"reviewed_by" uuid,
	"review_note" text,
	"subscription_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_service_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"tutor_id" uuid NOT NULL,
	"state_id" integer NOT NULL,
	"lga_id" integer NOT NULL,
	"city_id" integer
);
--> statement-breakpoint
CREATE TABLE "tutor_subjects" (
	"tutor_id" uuid NOT NULL,
	"subject_id" integer NOT NULL,
	"levels" "academic_level"[] NOT NULL,
	CONSTRAINT "tutor_subjects_tutor_id_subject_id_pk" PRIMARY KEY("tutor_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"phone" varchar(20),
	"password_hash" text NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"display_name" varchar(60),
	"avatar_url" text,
	"is_student" boolean DEFAULT false NOT NULL,
	"is_tutor" boolean DEFAULT false NOT NULL,
	"admin_role" "admin_role",
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"onboarding_step" "onboarding_step" DEFAULT 'verify_email' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone_verified_at" timestamp with time zone,
	"state_id" integer,
	"lga_id" integer,
	"city_id" integer,
	"timezone" varchar(64) DEFAULT 'Africa/Lagos' NOT NULL,
	"referred_by_user_id" uuid,
	"last_seen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(20) NOT NULL,
	"event_key" varchar(160) NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"outcome" varchar(40),
	"error" text
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tutor_id_tutor_profiles_user_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lga_id_lgas_id_fk" FOREIGN KEY ("lga_id") REFERENCES "public"."lgas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_lga_id_lgas_id_fk" FOREIGN KEY ("lga_id") REFERENCES "public"."lgas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_results" ADD CONSTRAINT "leaderboard_results_cycle_id_leaderboard_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."leaderboard_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_results" ADD CONSTRAINT "leaderboard_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lgas" ADD CONSTRAINT "lgas_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_tutor_id_tutor_profiles_user_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_tutor_id_tutor_profiles_user_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tutor_id_tutor_profiles_user_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_rewards" ADD CONSTRAINT "student_rewards_cycle_id_leaderboard_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."leaderboard_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_rewards" ADD CONSTRAINT "student_rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tutor_id_tutor_profiles_user_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_availability" ADD CONSTRAINT "tutor_availability_tutor_id_tutor_profiles_user_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_bank_accounts" ADD CONSTRAINT "tutor_bank_accounts_tutor_id_tutor_profiles_user_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_exams" ADD CONSTRAINT "tutor_exams_tutor_id_tutor_profiles_user_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_exams" ADD CONSTRAINT "tutor_exams_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_profiles" ADD CONSTRAINT "tutor_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_qualifications" ADD CONSTRAINT "tutor_qualifications_tutor_id_tutor_profiles_user_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_rewards" ADD CONSTRAINT "tutor_rewards_cycle_id_leaderboard_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."leaderboard_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_rewards" ADD CONSTRAINT "tutor_rewards_tutor_id_tutor_profiles_user_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_service_areas" ADD CONSTRAINT "tutor_service_areas_tutor_id_tutor_profiles_user_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_service_areas" ADD CONSTRAINT "tutor_service_areas_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_service_areas" ADD CONSTRAINT "tutor_service_areas_lga_id_lgas_id_fk" FOREIGN KEY ("lga_id") REFERENCES "public"."lgas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_service_areas" ADD CONSTRAINT "tutor_service_areas_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_subjects" ADD CONSTRAINT "tutor_subjects_tutor_id_tutor_profiles_user_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutor_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_subjects" ADD CONSTRAINT "tutor_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_lga_id_lgas_id_fk" FOREIGN KEY ("lga_id") REFERENCES "public"."lgas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_uq" ON "attempts" USING btree ("challenge_id","user_id","attempt_no");--> statement-breakpoint
CREATE INDEX "attempts_user_idx" ON "attempts" USING btree ("user_id","submitted_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_student_idx" ON "bookings" USING btree ("student_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_tutor_idx" ON "bookings" USING btree ("tutor_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status","hold_expires_at");--> statement-breakpoint
CREATE INDEX "challenges_day_idx" ON "challenges" USING btree ("scheduled_for","status");--> statement-breakpoint
CREATE INDEX "challenges_creator_idx" ON "challenges" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "challenges_daily_uq" ON "challenges" USING btree ("creator_id","category","scheduled_for") WHERE status = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "cities_lga_name_uq" ON "cities" USING btree ("lga_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_entries_idem_uq" ON "credit_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_entries_user_idx" ON "credit_entries" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "cron_runs_key_uq" ON "cron_runs" USING btree ("run_key");--> statement-breakpoint
CREATE INDEX "engagement_creator_idx" ON "engagement_events" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_attempt_kind_uq" ON "engagement_events" USING btree ("attempt_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_cycles_start_uq" ON "leaderboard_cycles" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_results_uq" ON "leaderboard_results" USING btree ("cycle_id","scope","scope_key","user_id");--> statement-breakpoint
CREATE INDEX "leaderboard_results_rank_idx" ON "leaderboard_results" USING btree ("cycle_id","scope","scope_key","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_idem_uq" ON "ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_tutor_idx" ON "ledger_entries" USING btree ("tutor_id","kind");--> statement-breakpoint
CREATE INDEX "ledger_payment_idx" ON "ledger_entries" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lgas_state_name_uq" ON "lgas" USING btree ("state_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_time_tokens_hash_uq" ON "one_time_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "one_time_tokens_user_idx" ON "one_time_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "packages_tutor_idx" ON "packages" USING btree ("tutor_id","status");--> statement-breakpoint
CREATE INDEX "packages_search_idx" ON "packages" USING btree ("status","subject_id","level","format","price_ngn");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reference_uq" ON "payments" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_tx_uq" ON "payments" USING btree ("provider_tx_id");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_position_uq" ON "questions" USING btree ("challenge_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_events_uq" ON "referral_events" USING btree ("referral_id","milestone");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referred_uq" ON "referrals" USING btree ("referred_user_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking_uq" ON "reviews" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "reviews_tutor_idx" ON "reviews" USING btree ("tutor_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_rewards_uq" ON "student_rewards" USING btree ("cycle_id","user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_tutor_idx" ON "subscriptions" USING btree ("tutor_id","status","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_idem_uq" ON "subscriptions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "tutor_availability_tutor_idx" ON "tutor_availability" USING btree ("tutor_id","weekday");--> statement-breakpoint
CREATE INDEX "tutor_profiles_listed_rank_idx" ON "tutor_profiles" USING btree ("is_listed","rank_score");--> statement-breakpoint
CREATE UNIQUE INDEX "tutor_rewards_uq" ON "tutor_rewards" USING btree ("cycle_id","from_plan");--> statement-breakpoint
CREATE UNIQUE INDEX "tutor_service_areas_uq" ON "tutor_service_areas" USING btree ("tutor_id","lga_id","city_id");--> statement-breakpoint
CREATE INDEX "tutor_service_areas_lga_idx" ON "tutor_service_areas" USING btree ("lga_id");--> statement-breakpoint
CREATE INDEX "tutor_subjects_subject_idx" ON "tutor_subjects" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_location_idx" ON "users" USING btree ("state_id","lga_id","city_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_key_uq" ON "webhook_events" USING btree ("provider","event_key");