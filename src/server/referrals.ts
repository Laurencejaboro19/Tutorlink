import "server-only";
import { randomBytes } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { bookings, referralCodes, referralEvents, referrals, subscriptions, users } from "@/db/schema";
import { ngn, toKobo } from "@/lib/money";
import { notify } from "@/lib/notify";
import { getSetting } from "@/lib/settings";
import { issueCredit } from "./credits";

/**
 * Referral engine.
 *
 * Student referrals: ₦500 when the referred student verifies their email AND
 * completes onboarding; ₦500 more when they complete their first qualifying
 * (paid, ≥ referral.min_qualifying_session_ngn) session.
 *
 * Tutor referrals: ₦1,000 when the referred tutor pays for Premium/Premium+;
 * ₦2,000 more when they complete five qualifying paid sessions.
 *
 * All milestones are idempotent (unique referral_id + milestone) and credits are
 * issued inside the same transaction as the milestone record. Self-referrals are
 * impossible by construction (referrer == referred is rejected at signup) and a
 * referral is `flagged` when the signup IP matches the referrer's recent sessions.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function getOrCreateReferralCode(userId: string) {
  const existing = await db.query.referralCodes.findFirst({ where: eq(referralCodes.userId, userId) });
  if (existing) return existing.code;
  for (let i = 0; i < 5; i++) {
    const code = Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
    const [row] = await db.insert(referralCodes).values({ userId, code }).onConflictDoNothing().returning();
    if (row) return row.code;
  }
  throw new Error("Could not allocate referral code");
}

async function awardMilestone(
  tx: Tx,
  referral: typeof referrals.$inferSelect,
  milestone: "student_verified" | "student_first_session" | "tutor_paid_upgrade" | "tutor_five_sessions",
  amountNgn: string,
  trigger?: { type: string; id: string },
) {
  if (referral.flagged) return null;
  const [event] = await tx
    .insert(referralEvents)
    .values({ referralId: referral.id, milestone, amountNgn, triggerType: trigger?.type ?? null, triggerId: trigger?.id ?? null })
    .onConflictDoNothing({ target: [referralEvents.referralId, referralEvents.milestone] })
    .returning();
  if (!event) return null; // already awarded
  const expiryDays = await getSetting("referral.credit_expiry_days");
  const credit = await issueCredit(
    {
      userId: referral.referrerId,
      amountNgn,
      type: "referral",
      source: "referral",
      reason: `Referral milestone: ${milestone.replaceAll("_", " ")}`,
      referenceType: "referral_event",
      referenceId: event.id,
      idempotencyKey: `referral:${referral.id}:${milestone}`,
      expiresAt: new Date(Date.now() + expiryDays * 86_400_000),
    },
    tx,
  );
  if (credit) await tx.update(referralEvents).set({ creditEntryId: credit.id }).where(eq(referralEvents.id, event.id));
  await notify(
    {
      userId: referral.referrerId,
      type: "referral.milestone",
      title: "Referral credit earned",
      body: `₦${Number(amountNgn).toLocaleString()} credit added for a referral milestone.`,
      href: "/dashboard/referrals",
      dedupeKey: `notify:referral:${referral.id}:${milestone}`,
    },
    tx,
  );
  return credit;
}

/** Called after email verification; the milestone also requires onboarding completion. */
export async function onReferredUserVerified(userId: string) {
  await evaluateStudentVerified(userId);
}

async function evaluateStudentVerified(userId: string) {
  await db.transaction(async (tx) => {
    const u = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (!u?.emailVerifiedAt || u.onboardingStep !== "complete" || !u.isStudent) return;
    const r = await tx.query.referrals.findFirst({ where: eq(referrals.referredUserId, userId) });
    if (!r || r.kind !== "student") return;
    const amount = ngn(await getSetting("referral.student_verified_ngn"));
    await awardMilestone(tx, r, "student_verified", amount, { type: "user", id: userId });
  });
}

/** Called when onboarding completes (role now known). Reclassifies the referral and evaluates stage 1. */
export async function onOnboardingComplete(userId: string, roles: { isStudent: boolean; isTutor: boolean }) {
  const r = await db.query.referrals.findFirst({ where: eq(referrals.referredUserId, userId) });
  if (!r) return;
  // Tutors-only accounts become tutor referrals; "both" stays student (one programme per referral).
  if (roles.isTutor && !roles.isStudent && r.kind !== "tutor") {
    await db.update(referrals).set({ kind: "tutor" }).where(eq(referrals.id, r.id));
  }
  await evaluateStudentVerified(userId);
}

/** Called inside the booking-completion transaction. */
export async function onSessionCompleted(tx: Tx, booking: typeof bookings.$inferSelect) {
  const minQualifying = ngn(await getSetting("referral.min_qualifying_session_ngn"));
  if (toKobo(booking.priceNgn) < toKobo(minQualifying) || !booking.paymentId) return;

  // Student side: first qualifying session
  const studentRef = await tx.query.referrals.findFirst({ where: eq(referrals.referredUserId, booking.studentId) });
  if (studentRef && studentRef.kind === "student") {
    const amount = ngn(await getSetting("referral.student_first_session_ngn"));
    await awardMilestone(tx, studentRef, "student_first_session", amount, { type: "booking", id: booking.id });
  }

  // Tutor side: five qualifying paid sessions
  const tutorRef = await tx.query.referrals.findFirst({ where: eq(referrals.referredUserId, booking.tutorId) });
  if (tutorRef && tutorRef.kind === "tutor") {
    const [{ n }] = await tx
      .select({ n: count() })
      .from(bookings)
      .where(and(eq(bookings.tutorId, booking.tutorId), eq(bookings.status, "completed")));
    if (n >= 5) {
      const amount = ngn(await getSetting("referral.tutor_five_sessions_ngn"));
      await awardMilestone(tx, tutorRef, "tutor_five_sessions", amount, { type: "booking", id: booking.id });
    }
  }
}

/** Called inside the subscription-activation transaction (paid plans only). */
export async function onTutorPaidUpgrade(tx: Tx, tutorId: string, subscriptionId: string) {
  const r = await tx.query.referrals.findFirst({ where: eq(referrals.referredUserId, tutorId) });
  if (!r || r.kind !== "tutor") return;
  const sub = await tx.query.subscriptions.findFirst({ where: eq(subscriptions.id, subscriptionId) });
  if (!sub || sub.source !== "paid") return;
  const amount = ngn(await getSetting("referral.tutor_paid_upgrade_ngn"));
  await awardMilestone(tx, r, "tutor_paid_upgrade", amount, { type: "subscription", id: subscriptionId });
}

export async function referralSummary(userId: string) {
  const code = await getOrCreateReferralCode(userId);
  const rows = await db
    .select({
      id: referrals.id,
      kind: referrals.kind,
      flagged: referrals.flagged,
      createdAt: referrals.createdAt,
      name: users.fullName,
      onboardingStep: users.onboardingStep,
    })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.referredUserId))
    .where(eq(referrals.referrerId, userId))
    .orderBy(referrals.createdAt);
  const events = rows.length
    ? await db.query.referralEvents.findMany({ where: inArray(referralEvents.referralId, rows.map((r) => r.id)) })
    : [];
  return { code, referrals: rows, events };
}
