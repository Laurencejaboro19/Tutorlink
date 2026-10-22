import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { payments, subscriptions, tutorProfiles } from "@/db/schema";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { DomainError } from "@/lib/result";
import { addDays } from "@/lib/time";
import { createPaymentIntent } from "./payments";
import { getActiveSubscription, getPlan, type PlanCode } from "./plans";
import { onTutorPaidUpgrade } from "./referrals";

/**
 * Subscriptions are 30-day entitlements. Paid benefits start only after the payment
 * is verified (`onSubscriptionPaid`). Upgrades start a new period immediately (the
 * previous paid period is cancelled; no proration in v1 — documented). Downgrades
 * are "cancel at period end". Promotional rewards create `source = promotional`
 * rows with an idempotency key so a reward can never extend twice.
 */

export async function startPaidSubscription(tutorId: string, planCode: Exclude<PlanCode, "free">) {
  const plan = await getPlan(planCode);
  const profile = await db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, tutorId) });
  if (!profile) throw new DomainError("Tutor profile not found.");
  const current = await getActiveSubscription(tutorId);
  if (current?.planCode === planCode && current.source === "paid" && !current.cancelAtPeriodEnd) {
    throw new DomainError(`You are already on ${plan.name}. Renewal opens in the last 5 days of your period.`);
  }
  return db.transaction(async (tx) => {
    const now = new Date();
    const [sub] = await tx
      .insert(subscriptions)
      .values({ tutorId, planCode, status: "pending_payment", source: "paid", startsAt: now, endsAt: addDays(now, 30) })
      .returning();
    const payment = await createPaymentIntent({ userId: tutorId, purpose: "subscription", subscriptionId: sub.id, amountNgn: plan.monthlyFeeNgn, title: `${plan.name} plan`, description: "30-day tutor plan", tx });
    await tx.update(subscriptions).set({ paymentId: payment.id }).where(eq(subscriptions.id, sub.id));
    return { subscription: sub, payment };
  });
}

export async function onSubscriptionPaid(tx: Tx, subscriptionId: string, payment: typeof payments.$inferSelect) {
  const sub = await tx.query.subscriptions.findFirst({ where: eq(subscriptions.id, subscriptionId) });
  if (!sub || sub.status !== "pending_payment") return;
  const now = new Date();
  // If an existing paid subscription is active, the new one takes over from now.
  const current = await getActiveSubscription(sub.tutorId, tx);
  let startsAt = now;
  if (current && current.planCode === sub.planCode && current.source === "paid") {
    // Renewal of the same plan: extend from the current end date.
    startsAt = current.endsAt;
  } else if (current && current.source === "paid") {
    await tx.update(subscriptions).set({ status: "cancelled", cancelledAt: now, cancelAtPeriodEnd: false }).where(eq(subscriptions.id, current.id));
  }
  await tx
    .update(subscriptions)
    .set({ status: "active", startsAt, endsAt: addDays(startsAt, 30), paymentId: payment.id })
    .where(eq(subscriptions.id, sub.id));
  await audit({ actorId: sub.tutorId, action: "subscription.activated", targetType: "subscription", targetId: sub.id, after: { planCode: sub.planCode, startsAt, paymentId: payment.id } }, tx);
  await notify({ userId: sub.tutorId, type: "subscription.active", title: `Your ${sub.planCode === "premium_plus" ? "Premium+" : "Premium"} plan is active`, body: `Benefits apply from ${startsAt.toDateString()} for 30 days.`, href: "/tutor/subscription", dedupeKey: `notify:sub:${sub.id}:active` }, tx);
  await onTutorPaidUpgrade(tx, sub.tutorId, sub.id);
}

export async function onSubscriptionPaymentFailed(tx: Tx, subscriptionId: string, payment: typeof payments.$inferSelect) {
  await tx.update(subscriptions).set({ status: "cancelled", cancelledAt: new Date() }).where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.status, "pending_payment")));
  const sub = await tx.query.subscriptions.findFirst({ where: eq(subscriptions.id, subscriptionId) });
  if (sub) await notify({ userId: sub.tutorId, type: "subscription.failed", title: "Plan payment did not complete", body: payment.failureReason ?? "The payment was not successful. You can try again from your subscription page.", href: "/tutor/subscription", dedupeKey: `notify:sub:${sub.id}:failed` }, tx);
}

export async function cancelAtPeriodEnd(tutorId: string, subscriptionId: string) {
  const sub = await db.query.subscriptions.findFirst({ where: and(eq(subscriptions.id, subscriptionId), eq(subscriptions.tutorId, tutorId)) });
  if (!sub || sub.status !== "active") throw new DomainError("No active subscription to cancel.");
  await db.update(subscriptions).set({ cancelAtPeriodEnd: true, cancelledAt: new Date() }).where(eq(subscriptions.id, sub.id));
  await audit({ actorId: tutorId, action: "subscription.cancel_requested", targetType: "subscription", targetId: sub.id });
}

/** Grant a promotional month (tutor engagement reward / admin). Idempotent on `idempotencyKey`. */
export async function grantPromotionalMonth(tx: Tx, input: { tutorId: string; planCode: Exclude<PlanCode, "free">; idempotencyKey: string; reason: string; actorId: string | null }) {
  const current = await getActiveSubscription(input.tutorId, tx);
  // Promotional access starts after any current paid period so nobody loses paid time.
  const startsAt = current && current.endsAt > new Date() ? current.endsAt : new Date();
  const [row] = await tx
    .insert(subscriptions)
    .values({ tutorId: input.tutorId, planCode: input.planCode, status: "active", source: input.actorId ? "admin_grant" : "promotional", startsAt, endsAt: addDays(startsAt, 30), grantReason: input.reason, idempotencyKey: input.idempotencyKey })
    .onConflictDoNothing({ target: subscriptions.idempotencyKey })
    .returning();
  if (row) {
    await audit({ actorId: input.actorId, action: "subscription.promotional_grant", targetType: "subscription", targetId: row.id, after: { planCode: input.planCode, startsAt, reason: input.reason } }, tx);
    await notify({ userId: input.tutorId, type: "subscription.promo", title: `You earned a month of ${input.planCode === "premium_plus" ? "Premium+" : "Premium"}`, body: input.reason, href: "/tutor/subscription", dedupeKey: `notify:${input.idempotencyKey}` }, tx);
  }
  return row ?? null;
}

/** Cron: mark ended subscriptions as expired. Packages and history are untouched. */
export async function expireSubscriptions() {
  const rows = await db
    .update(subscriptions)
    .set({ status: "expired" })
    .where(and(inArray(subscriptions.status, ["active", "past_due"]), lt(subscriptions.endsAt, new Date())))
    .returning({ id: subscriptions.id, tutorId: subscriptions.tutorId, planCode: subscriptions.planCode });
  for (const r of rows) {
    await notify({ userId: r.tutorId, type: "subscription.expired", title: "Your plan has ended", body: "You are back on the Free plan (30% commission). Your packages and history are unchanged; packages above the Free limit stay published until you unpublish one.", href: "/tutor/subscription", dedupeKey: `notify:sub:${r.id}:expired` });
  }
  return rows.length;
}
