/**
 * TutorLink domain schema (PostgreSQL via Drizzle ORM).
 *
 * Conventions
 * - Money is NGN stored as numeric(12,2) strings; use lib/money.ts helpers. Never floats.
 * - Every financial table is append-only; corrections are new rows (adjustments/reversals).
 * - Timestamps are `timestamptz`; the UI renders in the user's timezone (default Africa/Lagos).
 * - Idempotency keys are UNIQUE so webhooks, cron jobs and retries cannot double-apply.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const accountStatusEnum = pgEnum("account_status", ["active", "suspended", "deleted"]);
export const adminRoleEnum = pgEnum("admin_role", ["super", "moderator", "finance"]);
export const onboardingStepEnum = pgEnum("onboarding_step", [
  "verify_email",
  "location",
  "role",
  "profile",
  "complete",
]);
export const verificationStateEnum = pgEnum("verification_state", [
  "not_submitted",
  "pending",
  "verified",
  "rejected",
  "needs_info",
]);
export const academicLevelEnum = pgEnum("academic_level", [
  "primary",
  "junior_secondary",
  "senior_secondary",
  "tertiary",
  "adult",
]);
export const teachingFormatEnum = pgEnum("teaching_format", ["physical", "online", "hybrid"]);
export const sessionFormatEnum = pgEnum("session_format", ["physical", "online"]);
export const packageStatusEnum = pgEnum("package_status", ["draft", "published", "unpublished", "archived"]);
export const planCodeEnum = pgEnum("plan_code", ["free", "premium", "premium_plus"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "pending_payment",
  "active",
  "past_due",
  "cancelled",
  "expired",
]);
export const subscriptionSourceEnum = pgEnum("subscription_source", ["paid", "promotional", "admin_grant"]);
export const paymentPurposeEnum = pgEnum("payment_purpose", ["booking", "subscription"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "initiated",
  "successful",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
]);
export const ledgerKindEnum = pgEnum("ledger_kind", [
  "payment_received",
  "processing_fee",
  "platform_commission",
  "tutor_earning",
  "refund",
  "payout",
  "adjustment",
]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "hold",
  "pending_payment",
  "confirmed",
  "completed",
  "cancelled_by_student",
  "cancelled_by_tutor",
  "no_show_student",
  "no_show_tutor",
  "disputed",
  "refunded",
  "expired",
]);
export const reviewStatusEnum = pgEnum("review_status", ["published", "hidden"]);
export const referralKindEnum = pgEnum("referral_kind", ["student", "tutor"]);
export const referralMilestoneEnum = pgEnum("referral_milestone", [
  "student_verified",
  "student_first_session",
  "tutor_paid_upgrade",
  "tutor_five_sessions",
]);
export const creditTypeEnum = pgEnum("credit_type", [
  "referral",
  "challenge_reward",
  "leaderboard_reward",
  "promotional",
  "redemption",
  "reversal",
  "adjustment",
]);
export const creditStatusEnum = pgEnum("credit_status", [
  "pending",
  "available",
  "redeemed",
  "reversed",
  "expired",
]);
export const challengeStatusEnum = pgEnum("challenge_status", [
  "draft",
  "in_review",
  "published",
  "rejected",
  "archived",
]);
export const attemptStatusEnum = pgEnum("attempt_status", ["in_progress", "submitted", "expired"]);
export const engagementKindEnum = pgEnum("engagement_kind", ["started", "completed", "repeat"]);
export const cycleStatusEnum = pgEnum("cycle_status", ["open", "finalized", "rewarded"]);
export const leaderboardScopeEnum = pgEnum("leaderboard_scope", ["nationwide", "state", "city", "subject"]);
export const rewardKindEnum = pgEnum("reward_kind", ["cash", "credit"]);
export const rewardStatusEnum = pgEnum("reward_status", [
  "pending_review",
  "approved",
  "rejected",
  "credited",
  "payout_initiated",
  "paid",
  "failed",
  "reversed",
]);
export const refundStatusEnum = pgEnum("refund_status", [
  "requested",
  "approved",
  "rejected",
  "processing",
  "completed",
  "failed",
]);
export const payoutStatusEnum = pgEnum("payout_status", [
  "requested",
  "approved",
  "initiated",
  "completed",
  "failed",
  "cancelled",
]);
export const reportStatusEnum = pgEnum("report_status", ["open", "investigating", "resolved", "dismissed"]);
export const notificationDeliveryEnum = pgEnum("notification_delivery", ["in_app", "email"]);

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 254 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    passwordHash: text("password_hash").notNull(),
    fullName: varchar("full_name", { length: 120 }).notNull(),
    displayName: varchar("display_name", { length: 60 }),
    avatarUrl: text("avatar_url"),
    isStudent: boolean("is_student").notNull().default(false),
    isTutor: boolean("is_tutor").notNull().default(false),
    adminRole: adminRoleEnum("admin_role"),
    status: accountStatusEnum("status").notNull().default("active"),
    onboardingStep: onboardingStepEnum("onboarding_step").notNull().default("verify_email"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    stateId: integer("state_id").references(() => states.id),
    lgaId: integer("lga_id").references(() => lgas.id),
    cityId: integer("city_id").references(() => cities.id),
    timezone: varchar("timezone", { length: 64 }).notNull().default("Africa/Lagos"),
    referredByUserId: uuid("referred_by_user_id"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    index("users_location_idx").on(t.stateId, t.lgaId, t.cityId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ip: varchar("ip", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const tokenPurposeEnum = pgEnum("token_purpose", ["verify_email", "reset_password"]);

export const oneTimeTokens = pgTable(
  "one_time_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: tokenPurposeEnum("purpose").notNull(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("one_time_tokens_hash_uq").on(t.tokenHash), index("one_time_tokens_user_idx").on(t.userId, t.purpose)],
);

/* ------------------------------------------------------------------ */
/* Reference data: Nigeria locations, subjects, exams                  */
/* ------------------------------------------------------------------ */

export const states = pgTable("states", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 80 }).notNull().unique(),
  code: varchar("code", { length: 4 }).notNull().unique(),
});

export const lgas = pgTable(
  "lgas",
  {
    id: serial("id").primaryKey(),
    stateId: integer("state_id")
      .notNull()
      .references(() => states.id),
    name: varchar("name", { length: 100 }).notNull(),
  },
  (t) => [uniqueIndex("lgas_state_name_uq").on(t.stateId, t.name)],
);

export const cities = pgTable(
  "cities",
  {
    id: serial("id").primaryKey(),
    lgaId: integer("lga_id")
      .notNull()
      .references(() => lgas.id),
    name: varchar("name", { length: 100 }).notNull(),
  },
  (t) => [uniqueIndex("cities_lga_name_uq").on(t.lgaId, t.name)],
);

export const subjects = pgTable("subjects", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  category: varchar("category", { length: 60 }).notNull(),
  active: boolean("active").notNull().default(true),
});

export const exams = pgTable("exams", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 40 }).notNull().unique(),
  name: varchar("name", { length: 80 }).notNull(),
  active: boolean("active").notNull().default(true),
});

/* ------------------------------------------------------------------ */
/* Tutors                                                              */
/* ------------------------------------------------------------------ */

export const tutorProfiles = pgTable(
  "tutor_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    headline: varchar("headline", { length: 120 }),
    bio: text("bio"),
    yearsExperience: smallint("years_experience").notNull().default(0),
    offersPhysical: boolean("offers_physical").notNull().default(false),
    offersOnline: boolean("offers_online").notNull().default(true),
    identityStatus: verificationStateEnum("identity_status").notNull().default("not_submitted"),
    identityDocumentType: varchar("identity_document_type", { length: 40 }),
    identityDocumentRef: text("identity_document_ref"), // private storage key, never public
    identityReviewNote: text("identity_review_note"),
    qualificationStatus: verificationStateEnum("qualification_status").notNull().default("not_submitted"),
    qualificationReviewNote: text("qualification_review_note"),
    isListed: boolean("is_listed").notNull().default(false),
    // Aggregates maintained by trusted server code (see lib/ranking.ts)
    ratingAvg: numeric("rating_avg", { precision: 4, scale: 2 }).notNull().default("0"),
    ratingCount: integer("rating_count").notNull().default(0),
    completedSessions: integer("completed_sessions").notNull().default(0),
    cancelledByTutor: integer("cancelled_by_tutor").notNull().default(0),
    repeatStudents: integer("repeat_students").notNull().default(0),
    avgResponseSeconds: integer("avg_response_seconds"),
    rankScore: numeric("rank_score", { precision: 8, scale: 4 }).notNull().default("0"),
    rankUpdatedAt: timestamp("rank_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tutor_profiles_listed_rank_idx").on(t.isListed, t.rankScore)],
);

export const tutorSubjects = pgTable(
  "tutor_subjects",
  {
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => tutorProfiles.userId, { onDelete: "cascade" }),
    subjectId: integer("subject_id")
      .notNull()
      .references(() => subjects.id),
    levels: academicLevelEnum("levels").array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tutorId, t.subjectId] }), index("tutor_subjects_subject_idx").on(t.subjectId)],
);

export const tutorExams = pgTable(
  "tutor_exams",
  {
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => tutorProfiles.userId, { onDelete: "cascade" }),
    examId: integer("exam_id")
      .notNull()
      .references(() => exams.id),
  },
  (t) => [primaryKey({ columns: [t.tutorId, t.examId] })],
);

export const tutorQualifications = pgTable("tutor_qualifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorId: uuid("tutor_id")
    .notNull()
    .references(() => tutorProfiles.userId, { onDelete: "cascade" }),
  title: varchar("title", { length: 160 }).notNull(),
  institution: varchar("institution", { length: 160 }).notNull(),
  yearObtained: smallint("year_obtained"),
  documentRef: text("document_ref"), // private storage key
  status: verificationStateEnum("status").notNull().default("pending"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tutorServiceAreas = pgTable(
  "tutor_service_areas",
  {
    id: serial("id").primaryKey(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => tutorProfiles.userId, { onDelete: "cascade" }),
    stateId: integer("state_id")
      .notNull()
      .references(() => states.id),
    lgaId: integer("lga_id")
      .notNull()
      .references(() => lgas.id),
    cityId: integer("city_id").references(() => cities.id), // null = whole LGA
  },
  (t) => [uniqueIndex("tutor_service_areas_uq").on(t.tutorId, t.lgaId, t.cityId), index("tutor_service_areas_lga_idx").on(t.lgaId)],
);

/** Weekly recurring availability window, minutes from midnight in the tutor's timezone. */
export const tutorAvailability = pgTable(
  "tutor_availability",
  {
    id: serial("id").primaryKey(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => tutorProfiles.userId, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(), // 0 = Sunday … 6 = Saturday
    startMinute: smallint("start_minute").notNull(),
    endMinute: smallint("end_minute").notNull(),
    format: teachingFormatEnum("format").notNull().default("hybrid"),
  },
  (t) => [index("tutor_availability_tutor_idx").on(t.tutorId, t.weekday)],
);

export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => tutorProfiles.userId, { onDelete: "cascade" }),
    title: varchar("title", { length: 120 }).notNull(),
    description: text("description").notNull(),
    subjectId: integer("subject_id")
      .notNull()
      .references(() => subjects.id),
    level: academicLevelEnum("level").notNull(),
    examId: integer("exam_id").references(() => exams.id),
    format: teachingFormatEnum("format").notNull(),
    priceNgn: numeric("price_ngn", { precision: 12, scale: 2 }).notNull(),
    durationMinutes: smallint("duration_minutes").notNull(),
    sessionsCount: smallint("sessions_count").notNull().default(1),
    outcomes: text("outcomes").array().notNull().default(sql`'{}'::text[]`),
    requirements: text("requirements"),
    status: packageStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("packages_tutor_idx").on(t.tutorId, t.status),
    index("packages_search_idx").on(t.status, t.subjectId, t.level, t.format, t.priceNgn),
  ],
);

/* ------------------------------------------------------------------ */
/* Subscriptions & plans                                               */
/* ------------------------------------------------------------------ */

export const subscriptionPlans = pgTable("subscription_plans", {
  code: planCodeEnum("code").primaryKey(),
  name: varchar("name", { length: 40 }).notNull(),
  monthlyFeeNgn: numeric("monthly_fee_ngn", { precision: 12, scale: 2 }).notNull(),
  commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }).notNull(),
  maxPublishedPackages: integer("max_published_packages"), // null = unlimited
  visibilityBoost: numeric("visibility_boost", { precision: 4, scale: 2 }).notNull().default("0"),
  profileBoostEligible: boolean("profile_boost_eligible").notNull().default(false),
  analyticsTools: boolean("analytics_tools").notNull().default(false),
  sortOrder: smallint("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => tutorProfiles.userId, { onDelete: "cascade" }),
    planCode: planCodeEnum("plan_code").notNull(),
    status: subscriptionStatusEnum("status").notNull().default("pending_payment"),
    source: subscriptionSourceEnum("source").notNull().default("paid"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    paymentId: uuid("payment_id"),
    grantReason: text("grant_reason"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subscriptions_tutor_idx").on(t.tutorId, t.status, t.endsAt),
    uniqueIndex("subscriptions_idem_uq").on(t.idempotencyKey),
  ],
);

/* ------------------------------------------------------------------ */
/* Bookings                                                            */
/* ------------------------------------------------------------------ */

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => tutorProfiles.userId),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
    format: sessionFormatEnum("format").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: bookingStatusEnum("status").notNull().default("hold"),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    // Price snapshot (server computed, never from client)
    priceNgn: numeric("price_ngn", { precision: 12, scale: 2 }).notNull(),
    creditAppliedNgn: numeric("credit_applied_ngn", { precision: 12, scale: 2 }).notNull().default("0"),
    amountDueNgn: numeric("amount_due_ngn", { precision: 12, scale: 2 }).notNull(),
    planCodeAtBooking: planCodeEnum("plan_code_at_booking").notNull(),
    commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }).notNull(),
    commissionNgn: numeric("commission_ngn", { precision: 12, scale: 2 }).notNull(),
    tutorEarningNgn: numeric("tutor_earning_ngn", { precision: 12, scale: 2 }).notNull(),
    paymentId: uuid("payment_id"),
    // Physical session location
    lgaId: integer("lga_id").references(() => lgas.id),
    cityId: integer("city_id").references(() => cities.id),
    addressNote: text("address_note"),
    meetingLink: text("meeting_link"),
    studentNote: text("student_note"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    rescheduledFromId: uuid("rescheduled_from_id"),
    tutorFirstResponseAt: timestamp("tutor_first_response_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bookings_student_idx").on(t.studentId, t.startsAt),
    index("bookings_tutor_idx").on(t.tutorId, t.startsAt),
    index("bookings_status_idx").on(t.status, t.holdExpiresAt),
    // An EXCLUDE constraint preventing overlapping active bookings per tutor is added in
    // drizzle/0001_constraints.sql (btree_gist). Drizzle cannot express it declaratively.
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => tutorProfiles.userId),
    rating: smallint("rating").notNull(),
    comment: text("comment"),
    status: reviewStatusEnum("status").notNull().default("published"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reviews_booking_uq").on(t.bookingId), index("reviews_tutor_idx").on(t.tutorId, t.status)],
);

/* ------------------------------------------------------------------ */
/* Payments & financial ledger                                         */
/* ------------------------------------------------------------------ */

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: varchar("reference", { length: 80 }).notNull(), // tx_ref sent to Flutterwave
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    purpose: paymentPurposeEnum("purpose").notNull(),
    bookingId: uuid("booking_id"),
    subscriptionId: uuid("subscription_id"),
    amountNgn: numeric("amount_ngn", { precision: 12, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
    status: paymentStatusEnum("status").notNull().default("initiated"),
    provider: varchar("provider", { length: 20 }).notNull().default("flutterwave"),
    providerTxId: varchar("provider_tx_id", { length: 40 }),
    providerRef: varchar("provider_ref", { length: 80 }),
    providerFeeNgn: numeric("provider_fee_ngn", { precision: 12, scale: 2 }),
    checkoutUrl: text("checkout_url"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationPayload: jsonb("verification_payload"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payments_reference_uq").on(t.reference),
    uniqueIndex("payments_provider_tx_uq").on(t.providerTxId),
    index("payments_user_idx").on(t.userId, t.createdAt),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 20 }).notNull(),
    eventKey: varchar("event_key", { length: 160 }).notNull(), // e.g. charge.completed:12345:successful
    eventType: varchar("event_type", { length: 60 }).notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    outcome: varchar("outcome", { length: 40 }),
    error: text("error"),
  },
  (t) => [uniqueIndex("webhook_events_key_uq").on(t.provider, t.eventKey)],
);

/** Append-only double-entry style ledger. Positive = money into the named bucket. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: ledgerKindEnum("kind").notNull(),
    amountNgn: numeric("amount_ngn", { precision: 12, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
    paymentId: uuid("payment_id").references(() => payments.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    subscriptionId: uuid("subscription_id"),
    tutorId: uuid("tutor_id"), // beneficiary tutor for earnings/payouts
    userId: uuid("user_id"), // payer / refunded user
    refundId: uuid("refund_id"),
    payoutId: uuid("payout_id"),
    memo: text("memo"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    createdBy: uuid("created_by"), // admin for adjustments
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ledger_idem_uq").on(t.idempotencyKey),
    index("ledger_tutor_idx").on(t.tutorId, t.kind),
    index("ledger_payment_idx").on(t.paymentId),
  ],
);

export const refunds = pgTable("refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id),
  bookingId: uuid("booking_id").references(() => bookings.id),
  requestedBy: uuid("requested_by")
    .notNull()
    .references(() => users.id),
  amountNgn: numeric("amount_ngn", { precision: 12, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  status: refundStatusEnum("status").notNull().default("requested"),
  reviewedBy: uuid("reviewed_by"),
  reviewNote: text("review_note"),
  providerRef: varchar("provider_ref", { length: 80 }),
  providerPayload: jsonb("provider_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tutorBankAccounts = pgTable("tutor_bank_accounts", {
  tutorId: uuid("tutor_id")
    .primaryKey()
    .references(() => tutorProfiles.userId, { onDelete: "cascade" }),
  bankCode: varchar("bank_code", { length: 10 }).notNull(),
  bankName: varchar("bank_name", { length: 80 }).notNull(),
  accountNumberEnc: text("account_number_enc").notNull(), // AES-GCM encrypted
  accountLast4: varchar("account_last4", { length: 4 }).notNull(),
  accountName: varchar("account_name", { length: 120 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tutorId: uuid("tutor_id")
    .notNull()
    .references(() => tutorProfiles.userId),
  amountNgn: numeric("amount_ngn", { precision: 12, scale: 2 }).notNull(),
  status: payoutStatusEnum("status").notNull().default("requested"),
  reference: varchar("reference", { length: 80 }).notNull().unique(),
  approvedBy: uuid("approved_by"),
  providerRef: varchar("provider_ref", { length: 80 }),
  providerPayload: jsonb("provider_payload"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Referrals & credits                                                 */
/* ------------------------------------------------------------------ */

export const referralCodes = pgTable("referral_codes", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 16 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerId: uuid("referrer_id")
      .notNull()
      .references(() => users.id),
    referredUserId: uuid("referred_user_id")
      .notNull()
      .references(() => users.id),
    kind: referralKindEnum("kind").notNull(),
    signupIp: varchar("signup_ip", { length: 64 }),
    flagged: boolean("flagged").notNull().default(false),
    flagReason: text("flag_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("referrals_referred_uq").on(t.referredUserId), index("referrals_referrer_idx").on(t.referrerId)],
);

export const referralEvents = pgTable(
  "referral_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referralId: uuid("referral_id")
      .notNull()
      .references(() => referrals.id),
    milestone: referralMilestoneEnum("milestone").notNull(),
    creditEntryId: uuid("credit_entry_id"),
    amountNgn: numeric("amount_ngn", { precision: 12, scale: 2 }).notNull(),
    triggerType: varchar("trigger_type", { length: 40 }),
    triggerId: uuid("trigger_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("referral_events_uq").on(t.referralId, t.milestone)],
);

export const creditEntries = pgTable(
  "credit_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    amountNgn: numeric("amount_ngn", { precision: 12, scale: 2 }).notNull(), // signed
    type: creditTypeEnum("type").notNull(),
    status: creditStatusEnum("status").notNull().default("available"),
    source: varchar("source", { length: 60 }).notNull(),
    reason: text("reason").notNull(),
    referenceType: varchar("reference_type", { length: 40 }),
    referenceId: uuid("reference_id"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("credit_entries_idem_uq").on(t.idempotencyKey), index("credit_entries_user_idx").on(t.userId, t.status)],
);

/* ------------------------------------------------------------------ */
/* Challenges                                                          */
/* ------------------------------------------------------------------ */

export const challenges = pgTable(
  "challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id),
    title: varchar("title", { length: 140 }).notNull(),
    description: text("description"),
    subjectId: integer("subject_id").references(() => subjects.id),
    category: varchar("category", { length: 60 }).notNull(),
    level: academicLevelEnum("level"),
    examId: integer("exam_id").references(() => exams.id),
    scheduledFor: date("scheduled_for", { mode: "string" }).notNull(), // platform day (Africa/Lagos)
    timeLimitSeconds: integer("time_limit_seconds").notNull().default(600),
    maxAttempts: smallint("max_attempts").notNull().default(1),
    status: challengeStatusEnum("status").notNull().default("draft"),
    reviewedBy: uuid("reviewed_by"),
    reviewNote: text("review_note"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("challenges_day_idx").on(t.scheduledFor, t.status),
    index("challenges_creator_idx").on(t.creatorId),
    // one published challenge per creator per category per day
    uniqueIndex("challenges_daily_uq")
      .on(t.creatorId, t.category, t.scheduledFor)
      .where(sql`status = 'published'`),
  ],
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    type: varchar("type", { length: 20 }).notNull().default("multiple_choice"),
    prompt: text("prompt").notNull(),
    options: jsonb("options").$type<{ key: string; text: string }[]>().notNull(),
    correctKey: varchar("correct_key", { length: 8 }).notNull(), // NEVER selected into client responses
    explanation: text("explanation"),
    points: smallint("points").notNull().default(10),
  },
  (t) => [uniqueIndex("questions_position_uq").on(t.challengeId, t.position)],
);

export const attempts = pgTable(
  "attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challenges.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    attemptNo: smallint("attempt_no").notNull().default(1),
    status: attemptStatusEnum("status").notNull().default("in_progress"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    answers: jsonb("answers").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    score: integer("score").notNull().default(0),
    maxScore: integer("max_score").notNull().default(0),
    correctCount: smallint("correct_count").notNull().default(0),
    durationSeconds: integer("duration_seconds"),
  },
  (t) => [
    uniqueIndex("attempts_uq").on(t.challengeId, t.userId, t.attemptNo),
    index("attempts_user_idx").on(t.userId, t.submittedAt),
  ],
);

export const engagementEvents = pgTable(
  "engagement_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challenges.id),
    creatorId: uuid("creator_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: engagementKindEnum("kind").notNull(),
    attemptId: uuid("attempt_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("engagement_creator_idx").on(t.creatorId, t.createdAt), uniqueIndex("engagement_attempt_kind_uq").on(t.attemptId, t.kind)],
);

/* ------------------------------------------------------------------ */
/* Leaderboards & rewards                                              */
/* ------------------------------------------------------------------ */

export const leaderboardCycles = pgTable(
  "leaderboard_cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    durationDays: smallint("duration_days").notNull().default(30),
    status: cycleStatusEnum("status").notNull().default("open"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    rewardedAt: timestamp("rewarded_at", { withTimezone: true }),
    budgetNgn: numeric("budget_ngn", { precision: 12, scale: 2 }).notNull().default("50000"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("leaderboard_cycles_start_uq").on(t.startsAt)],
);

export const leaderboardResults = pgTable(
  "leaderboard_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => leaderboardCycles.id),
    scope: leaderboardScopeEnum("scope").notNull(),
    scopeKey: varchar("scope_key", { length: 40 }).notNull().default("all"), // stateId / cityId / subjectId / "all"
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    rank: integer("rank").notNull(),
    points: integer("points").notNull(),
    correctCount: integer("correct_count").notNull(),
    attemptsCount: integer("attempts_count").notNull(),
    totalDurationSeconds: integer("total_duration_seconds").notNull(),
    firstSubmissionAt: timestamp("first_submission_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("leaderboard_results_uq").on(t.cycleId, t.scope, t.scopeKey, t.userId), index("leaderboard_results_rank_idx").on(t.cycleId, t.scope, t.scopeKey, t.rank)],
);

export const studentRewards = pgTable(
  "student_rewards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => leaderboardCycles.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    rank: integer("rank").notNull(),
    kind: rewardKindEnum("kind").notNull(),
    amountNgn: numeric("amount_ngn", { precision: 12, scale: 2 }).notNull(),
    eligibilityNote: text("eligibility_note"),
    status: rewardStatusEnum("status").notNull().default("pending_review"),
    reviewedBy: uuid("reviewed_by"),
    reviewNote: text("review_note"),
    creditEntryId: uuid("credit_entry_id"),
    payoutId: uuid("payout_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("student_rewards_uq").on(t.cycleId, t.userId)],
);

export const tutorRewards = pgTable(
  "tutor_rewards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => leaderboardCycles.id),
    tutorId: uuid("tutor_id")
      .notNull()
      .references(() => tutorProfiles.userId),
    fromPlan: planCodeEnum("from_plan").notNull(),
    grantedPlan: planCodeEnum("granted_plan").notNull(),
    engagementScore: numeric("engagement_score", { precision: 10, scale: 2 }).notNull(),
    status: rewardStatusEnum("status").notNull().default("pending_review"),
    reviewedBy: uuid("reviewed_by"),
    reviewNote: text("review_note"),
    subscriptionId: uuid("subscription_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tutor_rewards_uq").on(t.cycleId, t.fromPlan)],
);

/* ------------------------------------------------------------------ */
/* Notifications, reports, audit, settings                             */
/* ------------------------------------------------------------------ */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 60 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    body: text("body").notNull(),
    href: varchar("href", { length: 300 }),
    dedupeKey: varchar("dedupe_key", { length: 160 }),
    delivery: notificationDeliveryEnum("delivery").notNull().default("in_app"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notifications_dedupe_uq").on(t.dedupeKey), index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterId: uuid("reporter_id")
    .notNull()
    .references(() => users.id),
  targetType: varchar("target_type", { length: 30 }).notNull(), // user | booking | challenge | review
  targetId: uuid("target_id").notNull(),
  reason: varchar("reason", { length: 60 }).notNull(),
  details: text("details"),
  status: reportStatusEnum("status").notNull().default("open"),
  handledBy: uuid("handled_by"),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    actorRole: varchar("actor_role", { length: 20 }),
    action: varchar("action", { length: 80 }).notNull(),
    targetType: varchar("target_type", { length: 40 }),
    targetId: varchar("target_id", { length: 64 }),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: varchar("ip", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_target_idx").on(t.targetType, t.targetId), index("audit_logs_actor_idx").on(t.actorId, t.createdAt)],
);

export const platformSettings = pgTable("platform_settings", {
  key: varchar("key", { length: 80 }).primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: varchar("key", { length: 160 }).primaryKey(),
    count: integer("count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const cronRuns = pgTable(
  "cron_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: varchar("job", { length: 60 }).notNull(),
    runKey: varchar("run_key", { length: 120 }).notNull(), // job + period, prevents double runs
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: jsonb("outcome"),
    error: text("error"),
  },
  (t) => [uniqueIndex("cron_runs_key_uq").on(t.runKey)],
);
