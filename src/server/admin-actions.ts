"use server";

import { z } from "zod";
import { assertAdmin, type AdminRole } from "@/lib/auth";
import { fail, succeed, toActionError, type ActionResult } from "@/lib/result";
import { moneySchema, parseForm, uuidSchema } from "@/lib/validation";
import {
  addBookingNote,
  addUserRole,
  adjustCredit,
  adminCancelBooking,
  archiveChallenge,
  cancelSubscriptionNow,
  financeApproveRefund,
  financeExecuteRefund,
  financeRejectRefund,
  forceUnlist,
  grantSubscriptionMonth,
  hideReview,
  requireRole,
  resolveBookingDispute,
  retryWebhookEvent,
  reverifyPayment,
  reverseCreditEntry,
  reviewIdentity,
  reviewQualification,
  revokeUserSessions,
  setAdminRole,
  setCycleBudget,
  setReferralFlag,
  setReportStatus,
  suspendUser,
  unsuspendUser,
  updatePlan,
  updateSetting,
  type AdminActor,
} from "@/server/admin";
import { reviewChallenge } from "@/server/challenges";
import { approveStudentReward, approveTutorReward, distributeRewards, finalizeCycle, markRewardFailed, markRewardPaid, rejectStudentReward, rejectTutorReward } from "@/server/leaderboards";
import { approvePayout, executePayout, markPayoutCompleted, markPayoutFailed, rejectPayout } from "@/server/payouts";

type R = ActionResult<{ redirectTo?: string }> | null;

const FIN: AdminRole[] = ["super", "finance"];
const MOD: AdminRole[] = ["super", "moderator"];
const SUPER: AdminRole[] = ["super"];
const ALL: AdminRole[] = ["super", "moderator", "finance"];

const confirmed = z.literal("on", { error: "Tick “I understand” to continue." });
const note = z.string().trim().max(2000).optional().default("");
const reason = z.string().trim().min(5, "Give a reason (at least 5 characters)").max(2000);

/**
 * Shared wrapper: authorise (assertAdmin → request context), validate the form, run the
 * service (which re-checks the role on the actor), and normalise errors.
 */
async function handle<T extends z.ZodTypeAny>(roles: AdminRole[], schema: T, formData: FormData, fn: (actor: AdminActor, data: z.infer<T>) => Promise<string | R | void>): Promise<R> {
  try {
    const user = await assertAdmin(roles);
    const actor: AdminActor = { id: user.id, adminRole: user.adminRole };
    requireRole(actor, roles);
    const parsed = parseForm(schema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    const out = await fn(actor, parsed.data);
    if (typeof out === "string") return succeed(undefined, out);
    return out ?? succeed(undefined, "Done.");
  } catch (e) {
    return toActionError(e);
  }
}

/* ---------------- users ---------------- */

export async function suspendUserAction(_p: R, fd: FormData): Promise<R> {
  return handle(MOD, z.object({ userId: uuidSchema, reason, confirm: confirmed }), fd, async (a, d) => {
    const r = await suspendUser(a, d.userId, d.reason);
    return `Account suspended. ${r.sessionsRevoked} session(s) signed out.`;
  });
}

export async function unsuspendUserAction(_p: R, fd: FormData): Promise<R> {
  return handle(MOD, z.object({ userId: uuidSchema, note }), fd, async (a, d) => {
    await unsuspendUser(a, d.userId, d.note);
    return "Account reinstated.";
  });
}

export async function revokeSessionsAction(_p: R, fd: FormData): Promise<R> {
  return handle(MOD, z.object({ userId: uuidSchema, confirm: confirmed }), fd, async (a, d) => `${await revokeUserSessions(a, d.userId)} session(s) revoked.`);
}

export async function setAdminRoleAction(_p: R, fd: FormData): Promise<R> {
  return handle(SUPER, z.object({ userId: uuidSchema, adminRole: z.enum(["none", "super", "moderator", "finance"]), confirm: confirmed }), fd, async (a, d) => {
    await setAdminRole(a, d.userId, d.adminRole === "none" ? null : d.adminRole);
    return d.adminRole === "none" ? "Admin access revoked." : `Admin role set to ${d.adminRole}.`;
  });
}

export async function addUserRoleAction(_p: R, fd: FormData): Promise<R> {
  return handle(SUPER, z.object({ userId: uuidSchema, role: z.enum(["student", "tutor"]) }), fd, async (a, d) => {
    await addUserRole(a, d.userId, d.role);
    return `${d.role === "student" ? "Student" : "Tutor"} role added.`;
  });
}

export async function adjustCreditAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ userId: uuidSchema, amountNgn: moneySchema, reason, confirm: confirmed }), fd, async (a, d) => {
    await adjustCredit(a, d.userId, d.amountNgn, d.reason);
    return "Credit adjustment issued.";
  });
}

export async function reverseCreditAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ entryId: uuidSchema, reason, confirm: confirmed }), fd, async (a, d) => {
    await reverseCreditEntry(a, d.entryId, d.reason);
    return "Credit entry reversed.";
  });
}

/* ---------------- tutor verification ---------------- */

const decision = z.enum(["verified", "rejected", "needs_info"]);

export async function reviewIdentityAction(_p: R, fd: FormData): Promise<R> {
  return handle(MOD, z.object({ tutorId: uuidSchema, decision, note }), fd, async (a, d) => {
    const r = await reviewIdentity(a, d.tutorId, d.decision, d.note);
    return `Identity marked ${d.decision.replaceAll("_", " ")}.${r.unlisted ? " The tutor was unlisted." : ""}`;
  });
}

export async function reviewQualificationAction(_p: R, fd: FormData): Promise<R> {
  return handle(MOD, z.object({ qualificationId: uuidSchema, decision, note }), fd, async (a, d) => {
    const r = await reviewQualification(a, d.qualificationId, d.decision, d.note);
    return `Qualification marked ${d.decision.replaceAll("_", " ")}. Overall status: ${r.overall.replaceAll("_", " ")}.`;
  });
}

export async function forceUnlistAction(_p: R, fd: FormData): Promise<R> {
  return handle(MOD, z.object({ tutorId: uuidSchema, reason, confirm: confirmed }), fd, async (a, d) => {
    await forceUnlist(a, d.tutorId, d.reason);
    return "Tutor removed from search.";
  });
}

/* ---------------- bookings ---------------- */

export async function resolveDisputeAction(_p: R, fd: FormData): Promise<R> {
  return handle(
    MOD,
    z.object({ bookingId: uuidSchema, outcome: z.enum(["completed", "no_show_student", "no_show_tutor", "refunded"]), refundPct: z.coerce.number().int().min(0).max(100), note: z.string().trim().min(5, "Add a resolution note").max(2000), confirm: confirmed }),
    fd,
    async (a, d) => {
      await resolveBookingDispute(a, { bookingId: d.bookingId, outcome: d.outcome, refundPct: d.refundPct, note: d.note });
      return "Dispute resolved.";
    },
  );
}

export async function adminCancelBookingAction(_p: R, fd: FormData): Promise<R> {
  return handle(MOD, z.object({ bookingId: uuidSchema, reason, confirm: confirmed }), fd, async (a, d) => {
    const r = await adminCancelBooking(a, d.bookingId, d.reason);
    return `Booking cancelled (${r.status.replaceAll("_", " ")}, refund ${r.quote.refundPct}%).`;
  });
}

export async function addBookingNoteAction(_p: R, fd: FormData): Promise<R> {
  return handle(ALL, z.object({ bookingId: uuidSchema, note: z.string().trim().min(2, "Write a note").max(2000) }), fd, async (a, d) => {
    await addBookingNote(a, d.bookingId, d.note);
    return "Note added to the audit trail.";
  });
}

/* ---------------- payments ---------------- */

export async function reverifyPaymentAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ paymentId: uuidSchema }), fd, async (a, d) => {
    const r = await reverifyPayment(a, d.paymentId);
    return `Provider status applied: ${r.status.replaceAll("_", " ")}${r.failureReason ? ` — ${r.failureReason}` : ""}.`;
  });
}

export async function retryWebhookAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ eventId: uuidSchema }), fd, async (a, d) => `Webhook re-run: ${await retryWebhookEvent(a, d.eventId)}.`);
}

export async function approveRefundAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ refundId: uuidSchema, note }), fd, async (a, d) => {
    await financeApproveRefund(a, d.refundId, d.note);
    return "Refund approved. Execute it to send the money.";
  });
}

export async function rejectRefundAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ refundId: uuidSchema, note: z.string().trim().min(3, "Add a note").max(2000) }), fd, async (a, d) => {
    await financeRejectRefund(a, d.refundId, d.note);
    return "Refund rejected.";
  });
}

export async function executeRefundAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ refundId: uuidSchema, confirm: confirmed }), fd, async (a, d) => {
    const r = await financeExecuteRefund(a, d.refundId);
    return `Refund is now ${r.status.replaceAll("_", " ")}${r.status === "failed" && r.reviewNote ? ` — ${r.reviewNote}` : ""}.`;
  });
}

export async function approvePayoutAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ payoutId: uuidSchema, confirm: confirmed }), fd, async (a, d) => {
    await approvePayout(a.id, d.payoutId);
    return "Payout approved; the ledger debit has been posted.";
  });
}

export async function rejectPayoutAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ payoutId: uuidSchema, reason }), fd, async (a, d) => {
    await rejectPayout(a.id, d.payoutId, d.reason);
    return "Payout rejected.";
  });
}

export async function executePayoutAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ payoutId: uuidSchema, confirm: confirmed }), fd, async (a, d) => {
    const r = await executePayout(a.id, d.payoutId);
    return r.status === "initiated" ? "Transfer initiated with the provider." : `Transfer not sent: ${r.failureReason ?? "provider refused"}.`;
  });
}

export async function markPayoutCompletedAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ payoutId: uuidSchema, confirm: confirmed }), fd, async (a, d) => {
    await markPayoutCompleted(a.id, d.payoutId);
    return "Payout marked completed.";
  });
}

export async function markPayoutFailedAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ payoutId: uuidSchema, reason, confirm: confirmed }), fd, async (a, d) => {
    await markPayoutFailed(a.id, d.payoutId, d.reason);
    return "Payout marked failed; the amount is back in the tutor's balance.";
  });
}

/* ---------------- subscriptions & plans ---------------- */

export async function cancelSubscriptionAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ subscriptionId: uuidSchema, reason, confirm: confirmed }), fd, async (a, d) => {
    await cancelSubscriptionNow(a, d.subscriptionId, d.reason);
    return "Subscription cancelled immediately.";
  });
}

export async function grantMonthAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ tutorId: uuidSchema, planCode: z.enum(["premium", "premium_plus"]), reason }), fd, async (a, d) => {
    const row = await grantSubscriptionMonth(a, d.tutorId, d.planCode, d.reason);
    return row ? `Granted 30 days of ${d.planCode === "premium_plus" ? "Premium+" : "Premium"} from ${row.startsAt.toDateString()}.` : "Already granted.";
  });
}

export async function updatePlanAction(_p: R, fd: FormData): Promise<R> {
  return handle(
    SUPER,
    z.object({
      code: z.enum(["free", "premium", "premium_plus"]),
      monthlyFeeNgn: moneySchema,
      commissionPct: moneySchema,
      maxPublishedPackages: z.string().trim().optional().default(""),
      visibilityBoost: moneySchema,
      profileBoostEligible: z.string().optional(),
      analyticsTools: z.string().optional(),
      active: z.string().optional(),
      confirm: confirmed,
    }),
    fd,
    async (a, d) => {
      const max = d.maxPublishedPackages === "" ? null : Number(d.maxPublishedPackages);
      if (max !== null && (!Number.isInteger(max) || max < 0)) return fail("Package limit must be a whole number (blank = unlimited).", { maxPublishedPackages: ["Whole number or blank"] });
      await updatePlan(a, d.code, { monthlyFeeNgn: d.monthlyFeeNgn, commissionPct: d.commissionPct, maxPublishedPackages: max, visibilityBoost: d.visibilityBoost, profileBoostEligible: !!d.profileBoostEligible, analyticsTools: !!d.analyticsTools, active: !!d.active });
      return `Plan ${d.code} updated. Historical bookings keep their snapshot.`;
    },
  );
}

/* ---------------- challenges ---------------- */

export async function reviewChallengeAction(_p: R, fd: FormData): Promise<R> {
  return handle(MOD, z.object({ challengeId: uuidSchema, decision: z.enum(["approve", "reject"]), note }), fd, async (a, d) => {
    await reviewChallenge(a.id, d.challengeId, d.decision, d.note || null);
    return d.decision === "approve" ? "Challenge approved and published." : "Challenge rejected.";
  });
}

export async function archiveChallengeAction(_p: R, fd: FormData): Promise<R> {
  return handle(MOD, z.object({ challengeId: uuidSchema, reason: note, confirm: confirmed }), fd, async (a, d) => {
    await archiveChallenge(a, d.challengeId, d.reason);
    return "Challenge archived.";
  });
}

/* ---------------- referrals ---------------- */

export async function setReferralFlagAction(_p: R, fd: FormData): Promise<R> {
  return handle(MOD, z.object({ referralId: uuidSchema, flagged: z.enum(["yes", "no"]), reason: note }), fd, async (a, d) => {
    await setReferralFlag(a, d.referralId, d.flagged === "yes", d.reason);
    return d.flagged === "yes" ? "Referral flagged; no further milestones will pay out." : "Referral unflagged.";
  });
}

/* ---------------- rewards & cycles ---------------- */

export async function approveStudentRewardAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ rewardId: uuidSchema }), fd, async (a, d) => {
    const r = await approveStudentReward(a.id, d.rewardId);
    return r.status === "credited" ? "Reward credited to the student's balance." : "Cash reward approved; mark it paid once the transfer is done.";
  });
}

export async function rejectStudentRewardAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ rewardId: uuidSchema, note: z.string().trim().min(3, "Give a reason").max(2000), confirm: confirmed }), fd, async (a, d) => {
    const r = await rejectStudentReward(a.id, d.rewardId, d.note);
    return `Reward ${r.status}.`;
  });
}

export async function markRewardPaidAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ rewardId: uuidSchema, payoutRef: z.string().trim().min(3, "Enter the payout reference").max(80), confirm: confirmed }), fd, async (a, d) => {
    await markRewardPaid(a.id, d.rewardId, d.payoutRef);
    return "Reward marked paid.";
  });
}

export async function markRewardFailedAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ rewardId: uuidSchema, note: z.string().trim().min(3, "Give a reason").max(2000) }), fd, async (a, d) => {
    await markRewardFailed(a.id, d.rewardId, d.note);
    return "Reward marked failed.";
  });
}

export async function approveTutorRewardAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ rewardId: uuidSchema }), fd, async (a, d) => {
    await approveTutorReward(a.id, d.rewardId);
    return "Tutor reward approved and plan month granted.";
  });
}

export async function rejectTutorRewardAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ rewardId: uuidSchema, note: z.string().trim().min(3, "Give a reason").max(2000) }), fd, async (a, d) => {
    await rejectTutorReward(a.id, d.rewardId, d.note);
    return "Tutor reward rejected.";
  });
}

export async function finalizeCycleAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ cycleId: uuidSchema, confirm: confirmed }), fd, async (_a, d) => {
    const r = await finalizeCycle(d.cycleId);
    return "alreadyFinalized" in r && r.alreadyFinalized ? "Cycle was already finalized." : `Cycle finalized: ${r.inserted} standings across ${r.scopes} scopes.`;
  });
}

export async function distributeRewardsAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ cycleId: uuidSchema, confirm: confirmed }), fd, async (_a, d) => {
    const r = await distributeRewards(d.cycleId);
    return "alreadyRewarded" in r && r.alreadyRewarded ? "Rewards were already distributed for this cycle." : `Rewards created: ${r.rewarded} (cash ${r.cash}, credit ${r.credit}, ineligible ${r.rejected}); tutor rewards ${r.tutorRewards}. Each one still needs finance review.`;
  });
}

export async function setCycleBudgetAction(_p: R, fd: FormData): Promise<R> {
  return handle(FIN, z.object({ cycleId: uuidSchema, budgetNgn: moneySchema }), fd, async (a, d) => {
    await setCycleBudget(a, d.cycleId, d.budgetNgn);
    return "Cycle budget updated.";
  });
}

/* ---------------- reports ---------------- */

export async function setReportStatusAction(_p: R, fd: FormData): Promise<R> {
  return handle(MOD, z.object({ reportId: uuidSchema, status: z.enum(["investigating", "resolved", "dismissed"]), note }), fd, async (a, d) => {
    await setReportStatus(a, d.reportId, d.status, d.note);
    return `Report marked ${d.status}.`;
  });
}

export async function hideReviewAction(_p: R, fd: FormData): Promise<R> {
  return handle(MOD, z.object({ reviewId: uuidSchema, reason, confirm: confirmed }), fd, async (a, d) => {
    await hideReview(a, d.reviewId, d.reason);
    return "Review hidden and tutor rank recomputed.";
  });
}

/* ---------------- settings ---------------- */

export async function updateSettingAction(_p: R, fd: FormData): Promise<R> {
  return handle(SUPER, z.object({ key: z.string().min(1).max(80), value: z.string().optional() }), fd, async (a, d) => {
    const v = await updateSetting(a, d.key, d.value);
    return `${d.key} saved as ${JSON.stringify(v)}.`;
  });
}
