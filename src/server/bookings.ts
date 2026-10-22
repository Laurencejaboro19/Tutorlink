import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { bookings, packages, payments, refunds, reviews, tutorAvailability, tutorProfiles, tutorServiceAreas, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { addNgn, compareNgn, fromKobo, minNgn, ngn, percentOf, subNgn, toKobo, type Ngn } from "@/lib/money";
import { notify } from "@/lib/notify";
import { DomainError } from "@/lib/result";
import { getSetting } from "@/lib/settings";
import { addMinutes, localParts } from "@/lib/time";
import { creditBalance, redeemCredit, reverseRedemption } from "./credits";
import { postLedger } from "./ledger";
import { createPaymentIntent } from "./payments";
import { getActivePlan } from "./plans";
import { recomputeTutorRank } from "./ranking";
import { onSessionCompleted } from "./referrals";

export type Booking = typeof bookings.$inferSelect;

/**
 * Booking lifecycle
 *   hold ──(payment intent)──▶ pending_payment ──(verified)──▶ confirmed ──▶ completed
 *     └─(hold expiry / payment failed)─▶ expired                 ├─▶ cancelled_by_student | cancelled_by_tutor
 *                                                                 ├─▶ no_show_student | no_show_tutor
 *                                                                 └─▶ disputed ─▶ completed | refunded
 * Overlap protection: EXCLUDE constraint on (tutor_id, tstzrange) for active statuses (23P01).
 * Prices, commissions and credit usage are computed here, never from the client.
 */

export async function quoteBooking(input: { packageId: string; studentId: string; useCredits: boolean }) {
  const pkg = await db.query.packages.findFirst({ where: eq(packages.id, input.packageId) });
  if (!pkg || pkg.status !== "published") throw new DomainError("This package is not available.");
  const { plan } = await getActivePlan(pkg.tutorId);
  const price = pkg.priceNgn;
  const commissionPct = plan.commissionPct;
  const commission = percentOf(price, commissionPct);
  const tutorEarning = subNgn(price, commission);
  let creditApplied: Ngn = "0.00";
  if (input.useCredits) {
    const balance = await creditBalance(input.studentId);
    const maxPct = await getSetting("credits.max_redeem_pct_of_booking");
    creditApplied = minNgn(balance, percentOf(price, maxPct));
  }
  const amountDue = subNgn(price, creditApplied);
  return { pkg, planCode: plan.code, price, commissionPct, commission, tutorEarning, creditApplied, amountDue };
}

function isWithinAvailability(windows: (typeof tutorAvailability.$inferSelect)[], startsAt: Date, endsAt: Date, format: "physical" | "online") {
  const s = localParts(startsAt);
  const e = localParts(endsAt);
  if (s.weekday !== e.weekday) return false; // sessions don't cross midnight in v1
  return windows.some((w) => w.weekday === s.weekday && w.startMinute <= s.minute && w.endMinute >= e.minute && (w.format === "hybrid" || w.format === format));
}

export async function createBooking(input: {
  studentId: string;
  packageId: string;
  startsAt: Date;
  format: "physical" | "online";
  lgaId?: number | null;
  cityId?: number | null;
  addressNote?: string | null;
  studentNote?: string | null;
  useCredits: boolean;
}) {
  const q = await quoteBooking({ packageId: input.packageId, studentId: input.studentId, useCredits: input.useCredits });
  const { pkg } = q;
  if (pkg.tutorId === input.studentId) throw new DomainError("You cannot book your own package.");
  if (pkg.format !== "hybrid" && pkg.format !== input.format) throw new DomainError(`This package is ${pkg.format} only.`);

  const [minLead, maxAhead, holdMinutes] = await Promise.all([getSetting("booking.min_lead_hours"), getSetting("booking.max_days_ahead"), getSetting("booking.hold_minutes")]);
  const now = new Date();
  if (input.startsAt.getTime() < now.getTime() + minLead * 3_600_000) throw new DomainError(`Sessions must start at least ${minLead} hours from now.`);
  if (input.startsAt.getTime() > now.getTime() + maxAhead * 86_400_000) throw new DomainError(`Sessions can be booked up to ${maxAhead} days ahead.`);
  const endsAt = addMinutes(input.startsAt, pkg.durationMinutes);

  const tutor = await db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, pkg.tutorId) });
  if (!tutor?.isListed) throw new DomainError("This tutor is not accepting bookings right now.");
  if (input.format === "physical") {
    if (!tutor.offersPhysical) throw new DomainError("This tutor does not offer in-person sessions.");
    if (!input.lgaId) throw new DomainError("Choose where the in-person session will take place.");
    const areas = await db.query.tutorServiceAreas.findMany({ where: eq(tutorServiceAreas.tutorId, pkg.tutorId) });
    const covered = areas.some((a) => a.lgaId === input.lgaId && (a.cityId === null || a.cityId === input.cityId));
    if (!covered) throw new DomainError("This tutor does not cover that area for in-person sessions. Try an online session or another tutor.");
  } else if (!tutor.offersOnline) throw new DomainError("This tutor does not offer online sessions.");

  const windows = await db.query.tutorAvailability.findMany({ where: eq(tutorAvailability.tutorId, pkg.tutorId) });
  if (!isWithinAvailability(windows, input.startsAt, endsAt, input.format)) throw new DomainError("That time is outside the tutor's availability. Pick another slot.");

  try {
    return await db.transaction(async (tx) => {
      const [booking] = await tx
        .insert(bookings)
        .values({
          studentId: input.studentId,
          tutorId: pkg.tutorId,
          packageId: pkg.id,
          format: input.format,
          startsAt: input.startsAt,
          endsAt,
          status: "pending_payment",
          holdExpiresAt: addMinutes(now, holdMinutes),
          priceNgn: q.price,
          creditAppliedNgn: q.creditApplied,
          amountDueNgn: q.amountDue,
          planCodeAtBooking: q.planCode,
          commissionPct: q.commissionPct,
          commissionNgn: q.commission,
          tutorEarningNgn: q.tutorEarning,
          lgaId: input.format === "physical" ? (input.lgaId ?? null) : null,
          cityId: input.format === "physical" ? (input.cityId ?? null) : null,
          addressNote: input.addressNote ?? null,
          studentNote: input.studentNote ?? null,
        })
        .returning();

      if (toKobo(q.creditApplied) > 0n) {
        await redeemCredit(tx, { userId: input.studentId, amountNgn: q.creditApplied, bookingId: booking.id, idempotencyKey: `redeem:${booking.id}` });
      }

      let payment: typeof payments.$inferSelect | null = null;
      if (toKobo(q.amountDue) > 0n) {
        payment = await createPaymentIntent({ userId: input.studentId, purpose: "booking", bookingId: booking.id, amountNgn: q.amountDue, title: pkg.title, description: "Tutoring session", tx });
        await tx.update(bookings).set({ paymentId: payment.id }).where(eq(bookings.id, booking.id));
      } else {
        // Fully covered by credits: confirm immediately.
        await confirmBooking(tx, booking.id, null);
      }
      await audit({ actorId: input.studentId, action: "booking.created", targetType: "booking", targetId: booking.id, after: { packageId: pkg.id, startsAt: input.startsAt, amountDue: q.amountDue } }, tx);
      return { booking, payment };
    });
  } catch (e) {
    // drizzle ≥0.44 wraps driver errors in DrizzleQueryError; the pg code lives on `cause`.
    const pgCode = (err: unknown): string | undefined => (err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : undefined);
    if (pgCode(e) === "23P01" || pgCode((e as { cause?: unknown })?.cause) === "23P01") {
      throw new DomainError("That slot was just taken. Please choose another time.");
    }
    throw e;
  }
}

async function confirmBooking(tx: Tx, bookingId: string, payment: typeof payments.$inferSelect | null) {
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
  if (!b || b.status !== "pending_payment") return b;
  const [updated] = await tx
    .update(bookings)
    .set({ status: "confirmed", confirmedAt: new Date(), holdExpiresAt: null, paymentId: payment?.id ?? b.paymentId, updatedAt: new Date() })
    .where(eq(bookings.id, b.id))
    .returning();
  // Commission and earning are recorded at confirmation on the full package price
  // (credits are a platform-funded discount; the tutor is paid in full).
  await postLedger(tx, [
    { kind: "platform_commission", amountNgn: b.commissionNgn, bookingId: b.id, paymentId: payment?.id ?? null, tutorId: null, idempotencyKey: `bk:${b.id}:commission`, memo: `Commission ${b.commissionPct}% (${b.planCodeAtBooking})` },
    { kind: "tutor_earning", amountNgn: b.tutorEarningNgn, bookingId: b.id, paymentId: payment?.id ?? null, tutorId: b.tutorId, idempotencyKey: `bk:${b.id}:earning`, memo: "Tutor allocation (accrued; payable after completion)" },
  ]);
  const student = await tx.query.users.findFirst({ where: eq(users.id, b.studentId) });
  await notify({ userId: b.tutorId, type: "booking.confirmed", title: "New confirmed booking", body: `${student?.displayName ?? "A student"} booked a session for ${b.startsAt.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}.`, href: `/tutor/bookings/${b.id}`, dedupeKey: `notify:bk:${b.id}:tutor_confirmed` }, tx);
  await notify({ userId: b.studentId, type: "booking.confirmed", title: "Session confirmed", body: "Your payment was verified and the session is booked.", href: `/dashboard/bookings/${b.id}`, dedupeKey: `notify:bk:${b.id}:student_confirmed` }, tx);
  return updated;
}

export async function onBookingPaid(tx: Tx, bookingId: string, payment: typeof payments.$inferSelect) {
  await confirmBooking(tx, bookingId, payment);
}

export async function onBookingPaymentFailed(tx: Tx, bookingId: string, payment: typeof payments.$inferSelect) {
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
  if (!b || b.status !== "pending_payment") return;
  await tx.update(bookings).set({ status: "expired", cancellationReason: payment.failureReason ?? "Payment failed", updatedAt: new Date() }).where(eq(bookings.id, b.id));
  if (toKobo(b.creditAppliedNgn) > 0n) await reverseRedemption(tx, { userId: b.studentId, amountNgn: b.creditAppliedNgn, bookingId: b.id, idempotencyKey: `unredeem:${b.id}`, reason: "Booking payment failed" });
  await notify({ userId: b.studentId, type: "booking.payment_failed", title: "Payment not completed", body: "The booking was released. You can try again.", href: `/dashboard/bookings`, dedupeKey: `notify:bk:${b.id}:failed` }, tx);
}

/** Cron: release holds whose payment never completed. */
export async function expireHolds() {
  const stale = await db.query.bookings.findMany({ where: and(inArray(bookings.status, ["hold", "pending_payment"]), lt(bookings.holdExpiresAt, new Date())) });
  let n = 0;
  for (const b of stale) {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(bookings).where(eq(bookings.id, b.id)).for("update");
      if (!locked || !["hold", "pending_payment"].includes(locked.status)) return;
      // If a payment succeeded in the meantime, confirm instead of expiring.
      if (locked.paymentId) {
        const p = await tx.query.payments.findFirst({ where: eq(payments.id, locked.paymentId) });
        if (p?.status === "successful") {
          await confirmBooking(tx, locked.id, p);
          return;
        }
        if (p?.status === "initiated") await tx.update(payments).set({ status: "cancelled", failureReason: "Hold expired", updatedAt: new Date() }).where(eq(payments.id, p.id));
      }
      await tx.update(bookings).set({ status: "expired", cancellationReason: "Payment window expired", updatedAt: new Date() }).where(eq(bookings.id, locked.id));
      if (toKobo(locked.creditAppliedNgn) > 0n) await reverseRedemption(tx, { userId: locked.studentId, amountNgn: locked.creditAppliedNgn, bookingId: locked.id, idempotencyKey: `unredeem:${locked.id}`, reason: "Booking hold expired" });
      n++;
    });
  }
  return n;
}

/* ---------------- cancellations & refunds ---------------- */

export async function cancellationQuote(b: Booking, by: "student" | "tutor") {
  if (by === "tutor") return { refundPct: 100, refundNgn: b.amountDueNgn, creditReturnNgn: b.creditAppliedNgn };
  const freeHours = await getSetting("booking.free_cancel_hours");
  const latePct = await getSetting("booking.late_cancel_refund_pct");
  const hoursLeft = (b.startsAt.getTime() - Date.now()) / 3_600_000;
  const pct = hoursLeft >= freeHours ? 100 : hoursLeft > 0 ? latePct : 0;
  return { refundPct: pct, refundNgn: percentOf(b.amountDueNgn, pct), creditReturnNgn: pct === 100 ? b.creditAppliedNgn : percentOf(b.creditAppliedNgn, pct) };
}

export async function cancelBooking(input: { bookingId: string; actorId: string; role: "student" | "tutor" | "admin"; reason: string }) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for("update");
    if (!b) throw new DomainError("Booking not found.");
    if (input.role === "student" && b.studentId !== input.actorId) throw new DomainError("Not your booking.");
    if (input.role === "tutor" && b.tutorId !== input.actorId) throw new DomainError("Not your booking.");
    if (!["confirmed", "pending_payment"].includes(b.status)) throw new DomainError(`A ${b.status.replaceAll("_", " ")} booking cannot be cancelled.`);
    if (b.startsAt.getTime() < Date.now() && input.role !== "admin") throw new DomainError("The session start time has passed. Use “report a problem” instead.");

    const byTutor = input.role === "tutor";
    const quote = await cancellationQuote(b, byTutor ? "tutor" : "student");
    const status = byTutor ? "cancelled_by_tutor" : "cancelled_by_student";
    await tx.update(bookings).set({ status, cancelledAt: new Date(), cancellationReason: input.reason, updatedAt: new Date() }).where(eq(bookings.id, b.id));

    if (b.status === "pending_payment") {
      if (b.paymentId) await tx.update(payments).set({ status: "cancelled", failureReason: "Booking cancelled before payment", updatedAt: new Date() }).where(and(eq(payments.id, b.paymentId), eq(payments.status, "initiated")));
      if (toKobo(b.creditAppliedNgn) > 0n) await reverseRedemption(tx, { userId: b.studentId, amountNgn: b.creditAppliedNgn, bookingId: b.id, idempotencyKey: `unredeem:${b.id}`, reason: "Booking cancelled" });
    } else {
      // Confirmed: reverse commission/earning proportionally and request a refund for the cash part.
      await reverseBookingAllocation(tx, b, quote.refundPct, `cancel:${b.id}`);
      if (toKobo(quote.creditReturnNgn) > 0n) await reverseRedemption(tx, { userId: b.studentId, amountNgn: quote.creditReturnNgn, bookingId: b.id, idempotencyKey: `unredeem:${b.id}:cancel`, reason: "Credit returned after cancellation" });
      if (b.paymentId && toKobo(quote.refundNgn) > 0n) {
        await tx.insert(refunds).values({ paymentId: b.paymentId, bookingId: b.id, requestedBy: input.actorId, amountNgn: quote.refundNgn, reason: `${byTutor ? "Tutor" : "Student"} cancellation: ${input.reason}`, status: byTutor ? "approved" : "requested" });
      }
      if (byTutor) await tx.update(tutorProfiles).set({ cancelledByTutor: sql`${tutorProfiles.cancelledByTutor} + 1` }).where(eq(tutorProfiles.userId, b.tutorId));
    }
    await audit({ actorId: input.actorId, actorRole: input.role, action: "booking.cancelled", targetType: "booking", targetId: b.id, before: { status: b.status }, after: { status, refundPct: quote.refundPct } }, tx);
    const other = byTutor ? b.studentId : b.tutorId;
    await notify({ userId: other, type: "booking.cancelled", title: "Session cancelled", body: `${byTutor ? "The tutor" : "The student"} cancelled the session. ${quote.refundPct ? `Refund: ${quote.refundPct}%.` : ""}`, href: byTutor ? `/dashboard/bookings/${b.id}` : `/tutor/bookings/${b.id}`, dedupeKey: `notify:bk:${b.id}:cancelled` }, tx);
    if (byTutor) await recomputeTutorRank(b.tutorId, tx);
    return { status, quote };
  });
}

/** Negative commission + earning rows for a (partial) refund. */
async function reverseBookingAllocation(tx: Tx, b: Booking, pct: number, keyPrefix: string) {
  if (pct <= 0) return;
  const commission = percentOf(b.commissionNgn, pct);
  const earning = percentOf(b.tutorEarningNgn, pct);
  await postLedger(tx, [
    { kind: "refund", amountNgn: `-${commission}`, bookingId: b.id, paymentId: b.paymentId, idempotencyKey: `${keyPrefix}:commission`, memo: `Commission reversed (${pct}%)` },
    { kind: "refund", amountNgn: `-${earning}`, bookingId: b.id, paymentId: b.paymentId, tutorId: b.tutorId, idempotencyKey: `${keyPrefix}:earning`, memo: `Tutor earning reversed (${pct}%)` },
  ]);
}

/* ---------------- completion, no-shows, disputes ---------------- */

export async function markCompleted(input: { bookingId: string; actorId: string; role: "student" | "tutor" | "admin" | "system" }) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for("update");
    if (!b) throw new DomainError("Booking not found.");
    if (input.role === "student" && b.studentId !== input.actorId) throw new DomainError("Not your booking.");
    if (input.role === "tutor" && b.tutorId !== input.actorId) throw new DomainError("Not your booking.");
    if (!["confirmed", "disputed"].includes(b.status)) throw new DomainError("Only confirmed sessions can be completed.");
    if (b.endsAt.getTime() > Date.now() && input.role !== "admin") throw new DomainError("The session has not ended yet.");
    const [updated] = await tx.update(bookings).set({ status: "completed", completedAt: new Date(), completedBy: input.role === "system" ? null : input.actorId, updatedAt: new Date() }).where(eq(bookings.id, b.id)).returning();
    await tx.update(tutorProfiles).set({ completedSessions: sql`${tutorProfiles.completedSessions} + 1` }).where(eq(tutorProfiles.userId, b.tutorId));
    await audit({ actorId: input.role === "system" ? null : input.actorId, actorRole: input.role, action: "booking.completed", targetType: "booking", targetId: b.id }, tx);
    await notify({ userId: b.studentId, type: "booking.completed", title: "How was your session?", body: "Leave a review to help other students and improve your tutor's ranking.", href: `/dashboard/bookings/${b.id}#review`, dedupeKey: `notify:bk:${b.id}:review` }, tx);
    await onSessionCompleted(tx, updated);
    await recomputeTutorRank(b.tutorId, tx);
    return updated;
  });
}

/** Cron: auto-complete confirmed sessions N hours after end if nobody disputed. */
export async function autoCompleteSessions() {
  const hours = await getSetting("booking.auto_complete_hours");
  const due = await db.query.bookings.findMany({ where: and(eq(bookings.status, "confirmed"), lt(bookings.endsAt, new Date(Date.now() - hours * 3_600_000))), limit: 200 });
  let n = 0;
  for (const b of due) {
    try {
      await markCompleted({ bookingId: b.id, actorId: "system", role: "system" });
      n++;
    } catch (e) {
      console.warn("auto-complete failed", b.id, e);
    }
  }
  return n;
}

export async function reportNoShow(input: { bookingId: string; actorId: string; role: "student" | "tutor"; details: string }) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for("update");
    if (!b) throw new DomainError("Booking not found.");
    if ((input.role === "student" && b.studentId !== input.actorId) || (input.role === "tutor" && b.tutorId !== input.actorId)) throw new DomainError("Not your booking.");
    if (b.status !== "confirmed") throw new DomainError("Only confirmed sessions can be reported.");
    if (b.startsAt.getTime() > Date.now()) throw new DomainError("The session has not started yet.");
    // Reports go to disputed; finance/moderation resolve to no_show_* with refund decisions.
    await tx.update(bookings).set({ status: "disputed", cancellationReason: `${input.role} reports no-show: ${input.details}`, updatedAt: new Date() }).where(eq(bookings.id, b.id));
    await audit({ actorId: input.actorId, actorRole: input.role, action: "booking.disputed", targetType: "booking", targetId: b.id, after: { details: input.details } }, tx);
    return b;
  });
}

/** Admin resolution of a disputed booking. */
export async function resolveDispute(input: { bookingId: string; adminId: string; outcome: "completed" | "no_show_student" | "no_show_tutor" | "refunded"; refundPct: number; note: string }) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for("update");
    if (!b || b.status !== "disputed") throw new DomainError("Booking is not disputed.");
    if (input.outcome === "completed") {
      await tx.update(bookings).set({ status: "completed", completedAt: new Date(), completedBy: input.adminId, updatedAt: new Date() }).where(eq(bookings.id, b.id));
      await tx.update(tutorProfiles).set({ completedSessions: sql`${tutorProfiles.completedSessions} + 1` }).where(eq(tutorProfiles.userId, b.tutorId));
    } else {
      await tx.update(bookings).set({ status: input.outcome, cancelledAt: new Date(), cancellationReason: input.note, updatedAt: new Date() }).where(eq(bookings.id, b.id));
      const pct = Math.max(0, Math.min(100, input.refundPct));
      await reverseBookingAllocation(tx, b, pct, `dispute:${b.id}`);
      const refundNgn = percentOf(b.amountDueNgn, pct);
      if (b.paymentId && toKobo(refundNgn) > 0n) await tx.insert(refunds).values({ paymentId: b.paymentId, bookingId: b.id, requestedBy: input.adminId, amountNgn: refundNgn, reason: `Dispute resolved: ${input.note}`, status: "approved", reviewedBy: input.adminId });
      const creditBack = percentOf(b.creditAppliedNgn, pct);
      if (toKobo(creditBack) > 0n) await reverseRedemption(tx, { userId: b.studentId, amountNgn: creditBack, bookingId: b.id, idempotencyKey: `unredeem:${b.id}:dispute`, reason: "Credit returned after dispute" });
      if (input.outcome === "no_show_tutor") await tx.update(tutorProfiles).set({ cancelledByTutor: sql`${tutorProfiles.cancelledByTutor} + 1` }).where(eq(tutorProfiles.userId, b.tutorId));
    }
    await audit({ actorId: input.adminId, actorRole: "admin", action: "booking.dispute_resolved", targetType: "booking", targetId: b.id, after: { outcome: input.outcome, refundPct: input.refundPct, note: input.note } }, tx);
    for (const uid of [b.studentId, b.tutorId]) await notify({ userId: uid, type: "booking.dispute_resolved", title: "Dispute resolved", body: `Outcome: ${input.outcome.replaceAll("_", " ")}. ${input.note}`, href: uid === b.studentId ? `/dashboard/bookings/${b.id}` : `/tutor/bookings/${b.id}`, dedupeKey: `notify:bk:${b.id}:dispute:${uid}` }, tx);
    await recomputeTutorRank(b.tutorId, tx);
  });
}

/* ---------------- reviews ---------------- */

export async function submitReview(input: { bookingId: string; studentId: string; rating: number; comment: string | null }) {
  const windowDays = await getSetting("booking.review_window_days");
  return db.transaction(async (tx) => {
    const b = await tx.query.bookings.findFirst({ where: eq(bookings.id, input.bookingId) });
    if (!b || b.studentId !== input.studentId) throw new DomainError("Booking not found.");
    if (b.status !== "completed") throw new DomainError("You can review a session once it is completed.");
    if (!b.completedAt || Date.now() - b.completedAt.getTime() > windowDays * 86_400_000) throw new DomainError("The review window for this session has closed.");
    if (input.rating < 1 || input.rating > 5) throw new DomainError("Rating must be 1–5.");
    const [row] = await tx
      .insert(reviews)
      .values({ bookingId: b.id, studentId: b.studentId, tutorId: b.tutorId, rating: input.rating, comment: input.comment })
      .onConflictDoNothing({ target: reviews.bookingId })
      .returning();
    if (!row) throw new DomainError("You already reviewed this session.");
    await recomputeTutorRank(b.tutorId, tx);
    await notify({ userId: b.tutorId, type: "review.new", title: "New review", body: `${input.rating}★ from a student.`, href: "/tutor", dedupeKey: `notify:review:${row.id}` }, tx);
    return row;
  });
}

/** Tutor's first response (accept/acknowledge) time — used by ranking. */
export async function recordTutorResponse(bookingId: string, tutorId: string) {
  await db.update(bookings).set({ tutorFirstResponseAt: new Date() }).where(and(eq(bookings.id, bookingId), eq(bookings.tutorId, tutorId), sql`${bookings.tutorFirstResponseAt} is null`));
}

export const __test = { addNgn, compareNgn, fromKobo, ngn, isWithinAvailability };
