import "server-only";
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { payments, users, webhookEvents } from "@/db/schema";
import { appUrl } from "@/lib/email";
import { compareNgn, ngn, percentOf, minNgn, type Ngn } from "@/lib/money";
import { DomainError } from "@/lib/result";
import { getSetting } from "@/lib/settings";
import { onBookingPaid, onBookingPaymentFailed } from "./bookings";
import { initializePayment, verifyByReference, verifyTransaction, type VerifiedTransaction } from "./flutterwave";
import { postLedger } from "./ledger";
import { onSubscriptionPaid, onSubscriptionPaymentFailed } from "./subscriptions";

/**
 * Payment lifecycle (all state changes happen here, on the server):
 *   initiated ─(verify ok)─▶ successful ─▶ (refunds) partially_refunded | refunded
 *             └(verify failed/cancelled)─▶ failed | cancelled
 *
 * Verification sources: (1) the redirect callback — we take tx id/ref from the URL and call
 * Flutterwave's verify endpoint; (2) the webhook — hash-checked, then re-verified. Both paths
 * converge in `applyVerification`, which is idempotent and transactional, so order and
 * duplication of events do not matter. A browser redirect is never treated as proof.
 */

export function newReference(prefix: "BK" | "SUB") {
  return `TL-${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function createPaymentIntent(input: {
  userId: string;
  purpose: "booking" | "subscription";
  bookingId?: string;
  subscriptionId?: string;
  amountNgn: Ngn;
  title: string;
  description: string;
  tx?: Tx;
}) {
  const exec = input.tx ?? db;
  const reference = newReference(input.purpose === "booking" ? "BK" : "SUB");
  const [payment] = await exec
    .insert(payments)
    .values({
      reference,
      userId: input.userId,
      purpose: input.purpose,
      bookingId: input.bookingId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      amountNgn: input.amountNgn,
      status: "initiated",
    })
    .returning();
  return payment;
}

/** Ask Flutterwave for a hosted checkout link for an `initiated` payment. */
export async function checkoutUrlFor(paymentId: string): Promise<string> {
  const payment = await db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!payment) throw new DomainError("Payment not found.");
  if (payment.status !== "initiated") throw new DomainError(`This payment is already ${payment.status}.`);
  if (payment.checkoutUrl) return payment.checkoutUrl;
  const user = await db.query.users.findFirst({ where: eq(users.id, payment.userId) });
  if (!user) throw new DomainError("User not found.");
  const title = payment.purpose === "booking" ? "TutorLink session" : "TutorLink subscription";
  const { link } = await initializePayment({
    txRef: payment.reference,
    amount: payment.amountNgn,
    customer: { email: user.email, name: user.fullName, phonenumber: user.phone },
    redirectUrl: appUrl(`/payments/callback?ref=${encodeURIComponent(payment.reference)}`),
    title,
    description: payment.purpose === "booking" ? "Tutoring session payment" : "Monthly tutor plan",
    meta: { payment_id: payment.id, purpose: payment.purpose },
  });
  await db.update(payments).set({ checkoutUrl: link, updatedAt: new Date() }).where(eq(payments.id, payment.id));
  return link;
}

/** Fetch the authoritative status for a reference and apply it. Used by the callback page. */
export async function reconcileByReference(reference: string, transactionId?: string | null) {
  const payment = await db.query.payments.findFirst({ where: eq(payments.reference, reference) });
  if (!payment) throw new DomainError("Unknown payment reference.");
  if (payment.status !== "initiated") return payment; // already settled; idempotent
  let verified: VerifiedTransaction | null = null;
  try {
    verified = transactionId ? await verifyTransaction(transactionId) : await verifyByReference(reference);
  } catch (e) {
    // Provider error or transaction not found yet: leave as initiated, surface to UI.
    console.warn("verify failed", reference, e instanceof Error ? e.message : e);
    return payment;
  }
  return applyVerification(verified);
}

/** Core idempotent settlement. Returns the payment row after applying. */
export async function applyVerification(v: VerifiedTransaction) {
  return db.transaction(async (tx) => {
    // Lock the payment row so concurrent webhook + callback can't double-apply.
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.reference, v.tx_ref))
      .for("update");
    if (!payment) throw new DomainError("Unknown payment reference.");
    if (payment.status !== "initiated") return payment;

    const amountOk = v.currency === "NGN" && compareNgn(ngn(v.amount), payment.amountNgn) >= 0;
    const success = v.status === "successful" && amountOk;

    if (!success) {
      const reason = v.status !== "successful" ? `Provider status: ${v.status}${v.processor_response ? ` (${v.processor_response})` : ""}` : `Amount/currency mismatch: paid ${v.amount} ${v.currency}, expected ${payment.amountNgn} NGN`;
      const [updated] = await tx
        .update(payments)
        .set({
          status: v.status === "cancelled" ? "cancelled" : "failed",
          providerTxId: String(v.id),
          providerRef: v.flw_ref,
          verificationPayload: v as object,
          verifiedAt: new Date(),
          failureReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id))
        .returning();
      if (payment.purpose === "booking" && payment.bookingId) await onBookingPaymentFailed(tx, payment.bookingId, updated);
      if (payment.purpose === "subscription" && payment.subscriptionId) await onSubscriptionPaymentFailed(tx, payment.subscriptionId, updated);
      return updated;
    }

    const feePct = await getSetting("payments.processing_fee_pct");
    const feeCap = ngn(await getSetting("payments.processing_fee_cap_ngn"));
    const providerFee = v.app_fee ? ngn(v.app_fee) : minNgn(percentOf(payment.amountNgn, feePct), feeCap);

    const [updated] = await tx
      .update(payments)
      .set({
        status: "successful",
        providerTxId: String(v.id),
        providerRef: v.flw_ref,
        providerFeeNgn: providerFee,
        verificationPayload: v as object,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id))
      .returning();

    await postLedger(tx, [
      { kind: "payment_received", amountNgn: payment.amountNgn, paymentId: payment.id, bookingId: payment.bookingId, subscriptionId: payment.subscriptionId, userId: payment.userId, idempotencyKey: `pay:${payment.id}:received`, memo: `Flutterwave ${v.flw_ref}` },
      { kind: "processing_fee", amountNgn: `-${providerFee}`, paymentId: payment.id, idempotencyKey: `pay:${payment.id}:fee`, memo: "Provider processing fee" },
    ]);

    if (payment.purpose === "booking" && payment.bookingId) await onBookingPaid(tx, payment.bookingId, updated);
    if (payment.purpose === "subscription" && payment.subscriptionId) await onSubscriptionPaid(tx, payment.subscriptionId, updated);
    return updated;
  });
}

/**
 * Webhook entry point. Records the raw event with a unique key, re-verifies with the
 * provider, applies. Returns a short outcome for the HTTP response.
 */
export async function handleWebhookEvent(payload: { event?: string; data?: Partial<VerifiedTransaction> & { id?: number; status?: string } }) {
  const eventType = payload.event ?? "unknown";
  const data = payload.data ?? {};
  const eventKey = `${eventType}:${data.id ?? data.tx_ref ?? "?"}:${data.status ?? "?"}`;
  const [row] = await db
    .insert(webhookEvents)
    .values({ provider: "flutterwave", eventKey, eventType, payload: payload as object })
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventKey] })
    .returning();
  if (!row) return { outcome: "duplicate" as const };

  try {
    if (eventType !== "charge.completed" || !data.tx_ref) {
      await db.update(webhookEvents).set({ processedAt: new Date(), outcome: "ignored" }).where(eq(webhookEvents.id, row.id));
      return { outcome: "ignored" as const };
    }
    const known = await db.query.payments.findFirst({ where: eq(payments.reference, data.tx_ref) });
    if (!known) {
      await db.update(webhookEvents).set({ processedAt: new Date(), outcome: "unknown_reference" }).where(eq(webhookEvents.id, row.id));
      return { outcome: "unknown_reference" as const };
    }
    // Never trust the webhook body for value: re-verify with the provider.
    const verified = data.id ? await verifyTransaction(data.id) : await verifyByReference(data.tx_ref);
    const applied = await applyVerification(verified);
    await db.update(webhookEvents).set({ processedAt: new Date(), outcome: applied.status }).where(eq(webhookEvents.id, row.id));
    return { outcome: applied.status };
  } catch (e) {
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), outcome: "error", error: e instanceof Error ? e.message : String(e) })
      .where(eq(webhookEvents.id, row.id));
    throw e;
  }
}

/** Expire stale `initiated` payments (cron). Bookings on hold are released by the bookings cron. */
export async function expireStalePayments(olderThanMinutes = 60) {
  const res = await db
    .update(payments)
    .set({ status: "cancelled", failureReason: "Checkout expired", updatedAt: new Date() })
    .where(sql`${payments.status} = 'initiated' and ${payments.createdAt} < now() - make_interval(mins => ${olderThanMinutes})`)
    .returning({ id: payments.id });
  return res.length;
}
