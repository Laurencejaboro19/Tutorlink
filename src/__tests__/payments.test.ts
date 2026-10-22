import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { bookings, creditEntries, ledgerEntries, packages, payments, payouts, refunds, subscriptions, tutorAvailability, tutorProfiles } from "@/db/schema";
import { toKobo } from "@/lib/money";
import { DomainError } from "@/lib/result";
import { addDays, platformDay, platformDayStart } from "@/lib/time";
import { createUser, truncateAll } from "./setup";

vi.mock("@/server/flutterwave", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/flutterwave")>();
  return {
    ...actual,
    initializePayment: vi.fn(async () => ({ link: "https://checkout.flutterwave.test/x" })),
    verifyTransaction: vi.fn(),
    verifyByReference: vi.fn(),
    refundTransaction: vi.fn(),
  };
});

import { FlutterwaveError, refundTransaction, verifyTransaction, type VerifiedTransaction } from "@/server/flutterwave";
import { applyVerification, handleWebhookEvent } from "@/server/payments";
import { cancelBooking, createBooking } from "@/server/bookings";
import { issueCredit, creditBalance } from "@/server/credits";
import { tutorBalances } from "@/server/ledger";
import { approveRefund, executeRefund } from "@/server/refunds";
import { approvePayout, executePayout, markPayoutFailed, requestPayout, saveBankAccount } from "@/server/payouts";
import { expireSubscriptions, startPaidSubscription } from "@/server/subscriptions";
import { POST as webhookPost } from "@/app/api/webhooks/flutterwave/route";

/* ---------------- helpers ---------------- */

let txSeq = 1000;

function verified(txRef: string, over: Partial<VerifiedTransaction> = {}): VerifiedTransaction {
  const id = over.id ?? ++txSeq;
  return { id, tx_ref: txRef, flw_ref: `FLW-${id}`, amount: 10000, charged_amount: 10000, app_fee: 140, currency: "NGN", status: "successful", ...over };
}

/** A listed tutor with all-day availability every weekday and one published ₦10,000 package. */
async function createTutorWithPackage(priceNgn = "10000.00") {
  const tutor = await createUser({ isTutor: true });
  await db.insert(tutorProfiles).values({ userId: tutor.id, isListed: true, offersOnline: true, offersPhysical: false, identityStatus: "verified", bio: "A tutor" });
  await db.insert(tutorAvailability).values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ tutorId: tutor.id, weekday, startMinute: 0, endMinute: 1440, format: "hybrid" as const })));
  const subject = await db.query.subjects.findFirst();
  if (!subject) throw new Error("subjects not seeded");
  const [pkg] = await db
    .insert(packages)
    .values({ tutorId: tutor.id, title: "Maths crash course", description: "Two hours of maths", subjectId: subject.id, level: "senior_secondary", format: "online", priceNgn, durationMinutes: 60, status: "published", publishedAt: new Date() })
    .returning();
  return { tutor, pkg };
}

/** 10:00 Lagos time tomorrow (+N days): always ≥ 2h ahead, within availability, never crossing midnight. */
function slot(daysAhead = 1, hour = 10) {
  return new Date(platformDayStart(platformDay(addDays(new Date(), daysAhead))).getTime() + hour * 3_600_000);
}

async function bookAndPay(opts: { daysAhead?: number } = {}) {
  const { tutor, pkg } = await createTutorWithPackage();
  const student = await createUser({ isStudent: true });
  const { booking, payment } = await createBooking({ studentId: student.id, packageId: pkg.id, startsAt: slot(opts.daysAhead ?? 1), format: "online", useCredits: false });
  if (!payment) throw new Error("expected a payment intent");
  await applyVerification(verified(payment.reference));
  return { tutor, student, pkg, booking, payment };
}

async function ledgerFor(paymentId: string) {
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.paymentId, paymentId));
}

beforeEach(async () => {
  await truncateAll();
  vi.mocked(verifyTransaction).mockReset();
  vi.mocked(refundTransaction).mockReset();
});

/* ---------------- verification ---------------- */

describe("applyVerification", () => {
  it("settles a successful booking payment: payment successful, booking confirmed, ledger split 3000/7000 on the free plan", async () => {
    const { tutor, pkg } = await createTutorWithPackage();
    const student = await createUser({ isStudent: true });
    const { booking, payment } = await createBooking({ studentId: student.id, packageId: pkg.id, startsAt: slot(), format: "online", useCredits: false });
    expect(payment?.status).toBe("initiated");
    expect(booking.status).toBe("pending_payment");
    expect(booking.planCodeAtBooking).toBe("free");

    const updated = await applyVerification(verified(payment!.reference));
    expect(updated.status).toBe("successful");
    expect(updated.providerRef).toMatch(/^FLW-/);

    const b = await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) });
    expect(b?.status).toBe("confirmed");
    expect(b?.confirmedAt).toBeTruthy();

    const rows = await ledgerFor(payment!.id);
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r.amountNgn]));
    expect(byKind.payment_received).toBe("10000.00");
    expect(byKind.processing_fee).toBe("-140.00");
    expect(byKind.platform_commission).toBe("3000.00");
    expect(byKind.tutor_earning).toBe("7000.00");
    expect(rows.find((r) => r.kind === "tutor_earning")?.tutorId).toBe(tutor.id);
    expect(rows).toHaveLength(4);

    const bal = await tutorBalances(tutor.id);
    expect(bal.available).toBe("7000.00");
  });

  it("is idempotent: the same verification applied twice adds no ledger rows", async () => {
    const { payment } = await bookAndPay();
    const before = await ledgerFor(payment.id);
    const again = await applyVerification(verified(payment.reference));
    expect(again.status).toBe("successful");
    const after = await ledgerFor(payment.id);
    expect(after).toHaveLength(before.length);
    expect(after).toHaveLength(4);
  });

  it("fails the payment and expires the booking when the verified amount is lower; applied credits are reversed", async () => {
    const { pkg } = await createTutorWithPackage();
    const student = await createUser({ isStudent: true });
    await issueCredit({ userId: student.id, amountNgn: "1000.00", type: "promotional", source: "test", reason: "seed", idempotencyKey: `test:credit:${student.id}` });
    expect(await creditBalance(student.id)).toBe("1000.00");

    const { booking, payment } = await createBooking({ studentId: student.id, packageId: pkg.id, startsAt: slot(), format: "online", useCredits: true });
    expect(booking.creditAppliedNgn).toBe("1000.00");
    expect(booking.amountDueNgn).toBe("9000.00");
    expect(await creditBalance(student.id)).toBe("0.00");

    const updated = await applyVerification(verified(payment!.reference, { amount: 5000, charged_amount: 5000 }));
    expect(updated.status).toBe("failed");
    expect(updated.failureReason).toMatch(/mismatch/i);

    const b = await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) });
    expect(b?.status).toBe("expired");
    expect(await creditBalance(student.id)).toBe("1000.00");
    const reversal = await db.query.creditEntries.findFirst({ where: and(eq(creditEntries.userId, student.id), eq(creditEntries.type, "reversal")) });
    expect(reversal?.amountNgn).toBe("1000.00");

    const rows = await ledgerFor(payment!.id);
    expect(rows).toHaveLength(0);
  });
});

/* ---------------- webhook ---------------- */

describe("handleWebhookEvent", () => {
  it("applies a known event once and reports duplicates on replay", async () => {
    const { pkg } = await createTutorWithPackage();
    const student = await createUser({ isStudent: true });
    const { payment } = await createBooking({ studentId: student.id, packageId: pkg.id, startsAt: slot(), format: "online", useCredits: false });
    const v = verified(payment!.reference);
    vi.mocked(verifyTransaction).mockResolvedValue(v);

    const payload = { event: "charge.completed", data: { id: v.id, tx_ref: v.tx_ref, status: "successful" } };
    const first = await handleWebhookEvent(payload);
    expect(first.outcome).toBe("successful");
    expect(verifyTransaction).toHaveBeenCalledWith(v.id);

    const second = await handleWebhookEvent(payload);
    expect(second.outcome).toBe("duplicate");
    expect(verifyTransaction).toHaveBeenCalledTimes(1);
    expect(await ledgerFor(payment!.id)).toHaveLength(4);
  });

  it("records unknown_reference for a tx_ref we never issued", async () => {
    const res = await handleWebhookEvent({ event: "charge.completed", data: { id: 1, tx_ref: "TL-BK-NOPE", status: "successful" } });
    expect(res.outcome).toBe("unknown_reference");
    expect(verifyTransaction).not.toHaveBeenCalled();
  });

  it("route rejects requests without a valid verif-hash with 401", async () => {
    const body = JSON.stringify({ event: "charge.completed", data: { id: 1, tx_ref: "x", status: "successful" } });
    const noHash = await webhookPost(new Request("http://localhost/api/webhooks/flutterwave", { method: "POST", body, headers: { "content-type": "application/json" } }));
    expect(noHash.status).toBe(401);
    const wrongHash = await webhookPost(new Request("http://localhost/api/webhooks/flutterwave", { method: "POST", body, headers: { "content-type": "application/json", "verif-hash": "wrong" } }));
    expect(wrongHash.status).toBe(401);
    // With the right hash the request is accepted (and the unknown reference is recorded, not an error).
    const ok = await webhookPost(new Request("http://localhost/api/webhooks/flutterwave", { method: "POST", body, headers: { "content-type": "application/json", "verif-hash": process.env.FLUTTERWAVE_WEBHOOK_HASH! } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, outcome: "unknown_reference" });
  });
});

/* ---------------- subscriptions ---------------- */

describe("subscriptions", () => {
  it("startPaidSubscription creates a pending sub + payment; verification activates it for 30 days and lowers commission to 20%", async () => {
    const { tutor, pkg } = await createTutorWithPackage();
    const { subscription, payment } = await startPaidSubscription(tutor.id, "premium");
    expect(subscription.status).toBe("pending_payment");
    expect(subscription.source).toBe("paid");
    expect(payment.purpose).toBe("subscription");
    expect(payment.amountNgn).toBe("3000.00");
    expect(payment.reference).toMatch(/^TL-SUB-/);

    const before = Date.now();
    await applyVerification(verified(payment.reference, { amount: 3000, charged_amount: 3000, app_fee: 42 }));
    const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, subscription.id) });
    expect(sub?.status).toBe("active");
    expect(sub?.paymentId).toBe(payment.id);
    expect(sub!.startsAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(sub!.endsAt.getTime() - sub!.startsAt.getTime()).toBe(30 * 86_400_000);

    const student = await createUser({ isStudent: true });
    const { booking } = await createBooking({ studentId: student.id, packageId: pkg.id, startsAt: slot(2), format: "online", useCredits: false });
    expect(booking.planCodeAtBooking).toBe("premium");
    expect(booking.commissionPct).toBe("20.00");
    expect(booking.commissionNgn).toBe("2000.00");
    expect(booking.tutorEarningNgn).toBe("8000.00");
  });

  it("expireSubscriptions moves ended subscriptions to expired and leaves current ones alone", async () => {
    const tutor = await createUser({ isTutor: true });
    await db.insert(tutorProfiles).values({ userId: tutor.id });
    const now = new Date();
    const [ended] = await db.insert(subscriptions).values({ tutorId: tutor.id, planCode: "premium", status: "active", source: "paid", startsAt: addDays(now, -40), endsAt: addDays(now, -10) }).returning();
    const [live] = await db.insert(subscriptions).values({ tutorId: tutor.id, planCode: "premium", status: "active", source: "promotional", startsAt: addDays(now, -5), endsAt: addDays(now, 25) }).returning();
    const n = await expireSubscriptions();
    expect(n).toBe(1);
    expect((await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, ended.id) }))?.status).toBe("expired");
    expect((await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, live.id) }))?.status).toBe("active");
  });
});

/* ---------------- refunds ---------------- */

describe("refunds", () => {
  async function cancelledByTutor() {
    const ctx = await bookAndPay();
    await cancelBooking({ bookingId: ctx.booking.id, actorId: ctx.tutor.id, role: "tutor", reason: "Sick" });
    const refund = await db.query.refunds.findFirst({ where: eq(refunds.bookingId, ctx.booking.id) });
    if (!refund) throw new Error("expected a refund row");
    expect(refund.status).toBe("approved"); // tutor cancellations are auto-approved by bookings.ts
    expect(refund.amountNgn).toBe("10000.00");
    return { ...ctx, refund };
  }

  it("approve + execute with a successful provider refund posts the cash ledger row and marks the payment refunded", async () => {
    const admin = await createUser({ adminRole: "finance" });
    const { refund, payment, booking, tutor } = await cancelledByTutor();
    // Commission/earning reversals were posted by bookings.ts at cancellation.
    const reversals = (await ledgerFor(payment.id)).filter((r) => r.kind === "refund");
    expect(reversals.map((r) => r.amountNgn).sort()).toEqual(["-3000.00", "-7000.00"]);
    expect((await tutorBalances(tutor.id)).available).toBe("0.00");

    await approveRefund(admin.id, refund.id, "ok"); // idempotent on an already-approved row
    vi.mocked(refundTransaction).mockResolvedValue({ id: 777, status: "completed" });
    const done = await executeRefund(admin.id, refund.id);
    expect(done.status).toBe("completed");
    expect(done.providerRef).toBe("777");
    const settled = await db.query.payments.findFirst({ where: eq(payments.id, payment.id) });
    expect(refundTransaction).toHaveBeenCalledWith(settled!.providerTxId, "10000.00");

    const cash = await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.idempotencyKey, `refund:${refund.id}:cash`) });
    expect(cash?.kind).toBe("refund");
    expect(cash?.amountNgn).toBe("-10000.00");
    expect(cash?.userId).toBe(payment.userId);
    // Only one cash row; reversals were not re-posted.
    expect((await ledgerFor(payment.id)).filter((r) => r.kind === "refund")).toHaveLength(3);

    expect((await db.query.payments.findFirst({ where: eq(payments.id, payment.id) }))?.status).toBe("refunded");
    expect((await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) }))?.status).toBe("refunded");

    // Executing again is a no-op.
    const again = await executeRefund(admin.id, refund.id);
    expect(again.status).toBe("completed");
    expect(refundTransaction).toHaveBeenCalledTimes(1);
  });

  it("a provider failure marks the refund failed with the reason and posts nothing", async () => {
    const admin = await createUser({ adminRole: "finance" });
    const { refund, payment, booking } = await cancelledByTutor();
    vi.mocked(refundTransaction).mockRejectedValue(new FlutterwaveError("Insufficient balance in merchant wallet", 400, { status: "error" }));
    const failed = await executeRefund(admin.id, refund.id);
    expect(failed.status).toBe("failed");
    expect(failed.reviewNote).toMatch(/Insufficient balance/);

    expect(await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.idempotencyKey, `refund:${refund.id}:cash`) })).toBeUndefined();
    expect((await db.query.payments.findFirst({ where: eq(payments.id, payment.id) }))?.status).toBe("successful");
    expect((await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) }))?.status).toBe("cancelled_by_tutor");
  });
});

/* ---------------- payouts ---------------- */

describe("payouts", () => {
  it("rejects a request above the available balance, approves with a ledger debit, and executePayout stays approved when transfers are disabled", async () => {
    const admin = await createUser({ adminRole: "finance" });
    const { tutor } = await bookAndPay(); // tutor now has ₦7,000 available
    expect((await tutorBalances(tutor.id)).available).toBe("7000.00");

    await expect(requestPayout(tutor.id, "5000")).rejects.toThrow(/bank details/);
    await saveBankAccount(tutor.id, { bankCode: "058", accountNumber: "0123456789", accountName: "Test Tutor" });
    const bank = await db.query.tutorBankAccounts.findFirst();
    expect(bank?.accountLast4).toBe("6789");
    expect(bank?.accountNumberEnc).not.toContain("0123456789");

    await expect(requestPayout(tutor.id, "8000")).rejects.toBeInstanceOf(DomainError);
    await expect(requestPayout(tutor.id, "1000")).rejects.toThrow(/minimum/i);

    const p = await requestPayout(tutor.id, "5000");
    expect(p.status).toBe("requested");
    expect(p.reference).toMatch(/^TL-PO-/);
    // Nothing posted yet; a second request for the remaining ₦2,000 is below the minimum, and ₦5,000 again exceeds what is left.
    expect((await tutorBalances(tutor.id)).available).toBe("7000.00");
    await expect(requestPayout(tutor.id, "5000")).rejects.toThrow(/request up to/);

    const approved = await approvePayout(admin.id, p.id);
    expect(approved.status).toBe("approved");
    const debit = await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.idempotencyKey, `payout:${p.id}`) });
    expect(debit?.kind).toBe("payout");
    expect(debit?.amountNgn).toBe("-5000.00");
    expect(debit?.tutorId).toBe(tutor.id);
    expect((await tutorBalances(tutor.id)).available).toBe("2000.00");
    expect((await tutorBalances(tutor.id)).paidOut).toBe("5000.00");
    // Approving twice posts nothing new.
    await approvePayout(admin.id, p.id);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.payoutId, p.id))).toHaveLength(1);

    expect(process.env.PAYOUTS_ENABLED).not.toBe("true");
    const after = await executePayout(admin.id, p.id);
    expect(after.status).toBe("approved");
    expect(after.failureReason).toMatch(/PAYOUTS_ENABLED/);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.payoutId, p.id))).toHaveLength(1);

    // A failed transfer returns the money with a reversing row.
    const failed = await markPayoutFailed(admin.id, p.id, "Bank rejected the account");
    expect(failed.status).toBe("failed");
    const reversal = await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.idempotencyKey, `payout:${p.id}:reversal`) });
    expect(reversal?.amountNgn).toBe("5000.00");
    expect((await tutorBalances(tutor.id)).available).toBe("7000.00");
    expect(toKobo((await db.query.payouts.findFirst({ where: eq(payouts.id, p.id) }))!.amountNgn)).toBe(500000n);
  });
});
