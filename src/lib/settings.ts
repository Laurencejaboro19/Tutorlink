import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";

/**
 * Platform configuration with safe defaults. Values live in platform_settings
 * (editable by super admins, audited). Commercial policies the product owner has
 * not yet fixed are listed here so they are explicit rather than hard-coded.
 */
export const settingDefaults = {
  // Bookings
  "booking.hold_minutes": 20, // reservation hold while the student pays
  "booking.min_lead_hours": 2, // earliest a session can start after booking
  "booking.max_days_ahead": 60,
  "booking.free_cancel_hours": 24, // student cancels ≥ this early → full refund eligible
  "booking.late_cancel_refund_pct": 50, // student cancels inside the window → partial
  "booking.tutor_cancel_penalty_strikes": 3,
  "booking.auto_complete_hours": 48, // auto-mark completed if nobody disputes
  "booking.review_window_days": 14,

  // Plans
  "plans.free_max_published_packages": 3,

  // Payments
  "payments.processing_fee_pct": 1.4, // Flutterwave local card fee (documented; deducted from platform side)
  "payments.processing_fee_cap_ngn": 2000,
  "payments.refund_fee_policy": "platform_absorbs", // or "deduct_from_refund"

  // Referrals
  "referral.student_verified_ngn": 500,
  "referral.student_first_session_ngn": 500,
  "referral.tutor_paid_upgrade_ngn": 1000,
  "referral.tutor_five_sessions_ngn": 2000,
  "referral.min_qualifying_session_ngn": 2000, // sessions below this do not count as "qualifying"
  "referral.credit_expiry_days": 180,

  // Credits
  "credits.max_redeem_pct_of_booking": 50, // credits can cover at most this % of a booking

  // Challenges
  "challenge.default_time_limit_seconds": 600,
  "challenge.default_max_attempts": 1,
  "challenge.require_review_for_tutor_challenges": true,
  "challenge.daily_cutoff_timezone": "Africa/Lagos",
  "challenge.max_attempts_per_user_per_day": 10, // anti-abuse

  // Leaderboards & rewards
  "leaderboard.cycle_days": 30,
  "leaderboard.top_n": 10,
  "leaderboard.reward_ngn": 5000,
  "leaderboard.cash_requires_active_subscription": true, // student must have had an active paid plan?… see README: students have no plan; rule below
  "leaderboard.cash_requires_paid_session_in_cycle": true,
  "leaderboard.cash_min_paid_session_ngn": 2000,
  "leaderboard.min_attempts_for_eligibility": 5,
  "leaderboard.cycle_budget_ngn": 50000,

  // Tutor engagement rewards
  "tutor_reward.min_unique_participants": 10,
  "tutor_reward.min_completion_rate_pct": 40,

  // Ranking (see lib/ranking.ts)
  "ranking.bayesian_prior_rating": 4.2,
  "ranking.bayesian_prior_weight": 5,
  "ranking.new_tutor_boost_days": 30,
  "ranking.new_tutor_boost": 0.15,

  // Payouts
  "payouts.min_amount_ngn": 5000,
  "payouts.require_admin_approval": true,

  // Safety
  "safety.minimum_age": 18, // accounts are for adults; guardians book for minors (see README)
} as const;

export type SettingKey = keyof typeof settingDefaults;
export type SettingValue<K extends SettingKey> = (typeof settingDefaults)[K];

const cache = new Map<string, { value: unknown; at: number }>();
const TTL_MS = 30_000;

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as SettingValue<K>;
  const row = await db.query.platformSettings.findFirst({ where: eq(platformSettings.key, key) });
  const value = (row?.value ?? settingDefaults[key]) as SettingValue<K>;
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function getSettings<K extends SettingKey>(keys: K[]): Promise<{ [P in K]: SettingValue<P> }> {
  const out = {} as { [P in K]: SettingValue<P> };
  for (const k of keys) out[k] = await getSetting(k);
  return out;
}

export async function setSetting(key: SettingKey, value: unknown, updatedBy: string | null) {
  await db
    .insert(platformSettings)
    .values({ key, value: value as object, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value: value as object, updatedBy, updatedAt: new Date() } });
  cache.delete(key);
}

export function clearSettingsCache() {
  cache.clear();
}
