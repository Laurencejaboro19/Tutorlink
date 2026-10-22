import "server-only";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings, payments, refunds, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { compareNgn, fromKobo, toKobo } from "@/lib/money";
import { notify } from "@/lib/notify";
import { DomainError } from "@/lib/result";
import { FlutterwaveError, refundTransaction } from "./flutterwave";
import { postLedger } from "./ledger";

/**
 * Refund lifecycle
 *   requested ─(admin approve)─▶ approved ─(execute: provider refund ok)─▶ completed
 *             └(admin reject)──▶ rejected                └(provider error)─▶ failed (admin may execute again or reject)
 *
 * Refund rows are created by the bookings service (cancellation / dispute resolution), which
 * ALSO posts the negative commission + earning ledger rows at that moment. This module only
 * posts the cash leg (`refund` −amount, userId = payer, key `refund:${id}:cash`) once the
 * provider confirms the money is going back. Nothing is double-posted.
 */

export type Refund = typeof refunds.$inferSelect;
export type RefundStatus = Refund["status"];

export function refundStatusLabel(s: RefundStatus) {
  const labels: Record<RefundStatus, string> = {
    requested: "Under review",
    approved: "Approved",
    rejected: "Rejected",
    processing: "Processing",
    completed: "Refunded",
    failed: "Failed",
  };
  return labels[s];
}

export async function approveRefund(adminId: string, refundId: string, note?: string | null) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for("update");
    if (!r) throw new DomainError("Refund not found.");
    if (r.status === "approved") return r;
    if (r.status !== "requested" && r.status !== "failed") throw new DomainError(`A ${refundStatusLabel(r.status).toLowerCase()} refund cannot be approved.`);
    const [updated] = await tx
      .update(refunds)
      .set({ status: "approved", reviewedBy: adminId, reviewNote: note?.trim() || r.reviewNote, updatedAt: new Date() })
      .where(eq(refunds.id, r.id))
      .returning();
    await audit({ actorId: adminId, actorRole: "admin", action: "refund.approved", targetType: "refund", targetId: r.id, before: { status: r.status }, after: { status: "approved", note } }, tx);
    return updated;
  });
}

export async function rejectRefund(adminId: string, refundId: string, note: string) {
  const reason = note.trim();
  if (reason.length < 3) throw new DomainError("Give the student a reason for the rejection.");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for("update");
    if (!r) throw new DomainError("Refund not found.");
    if (r.status !== "requested" && r.status !== "approved" && r.status !== "failed") throw new DomainError(`A ${refundStatusLabel(r.status).toLowerCase()} refund cannot be rejected.`);
    const [updated] = await tx.update(refunds).set({ status: "rejected", reviewedBy: adminId, reviewNote: reason, updatedAt: new Date() }).where(eq(refunds.id, r.id)).returning();
    await audit({ actorId: adminId, actorRole: "admin", action: "refund.rejected", targetType: "refund", targetId: r.id, before: { status: r.status }, after: { status: "rejected", note: reason } }, tx);
    const payment = await tx.query.payments.findFirst({ where: eq(payments.id, r.paymentId) });
    if (payment) {
      await notify({ userId: payment.userId, type: "refund.rejected", title: "Refund request declined", body: reason, href: r.bookingId ? `/dashboard/bookings/${r.bookingId}` : "/dashboard/payments", dedupeKey: `notify:refund:${r.id}:rejected` }, tx);
    }
    return updated;
  });
}

/**
 * Sends the refund to Flutterwave and settles the books on success.
 * The provider call happens outside the transaction (network); the row is marked
 * `processing` first so a concurrent click cannot send the refund twice.
 */
export async function executeRefund(adminId: string, refundId: string) {
  // Phase 1: claim the refund.
  const claimed = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for("update");
    if (!r) throw new DomainError("Refund not found.");
    if (r.status === "completed") return { r, payment: null, skip: true as const };
    if (r.status !== "approved" && r.status !== "failed") throw new DomainError(`Only approved refunds can be sent (this one is ${refundStatusLabel(r.status).toLowerCase()}).`);
    const payment = await tx.query.payments.findFirst({ where: eq(payments.id, r.paymentId) });
    if (!payment) throw new DomainError("The original payment was not found.");
    if (!payment.providerTxId) throw new DomainError("The original payment has no provider transaction id, so it cannot be refunded through Flutterwave.");
    if (!["successful", "partially_refunded"].includes(payment.status)) throw new DomainError(`The original payment is ${payment.status.replaceAll("_", " ")}, so there is nothing to refund.`);
    // Guard against over-refunding across multiple refund rows.
    const [{ done }] = await tx
      .select({ done: sql<string>`coalesce(sum(${refunds.amountNgn}),0)` })
      .from(refunds)
      .where(and(eq(refunds.paymentId, payment.id), inArray(refunds.status, ["completed", "processing"])));
    if (toKobo(done) + toKobo(r.amountNgn) > toKobo(payment.amountNgn)) {
      throw new DomainError(`This refund (₦${Number(r.amountNgn).toLocaleString("en-NG")}) would exceed the amount paid (₦${Number(payment.amountNgn).toLocaleString("en-NG")}).`);
    }
    await tx.update(refunds).set({ status: "processing", reviewedBy: r.reviewedBy ?? adminId, updatedAt: new Date() }).where(eq(refunds.id, r.id));
    return { r, payment, skip: false as const };
  });
  if (claimed.skip) return claimed.r;
  const { r, payment } = claimed;

  // Phase 2: provider call.
  let providerRes: { id: number; status: string };
  try {
    providerRes = await refundTransaction(payment.providerTxId!, r.amountNgn);
  } catch (e) {
    if (e instanceof FlutterwaveError) {
      const [failed] = await db
        .update(refunds)
        .set({ status: "failed", reviewNote: `Provider error: ${e.message}`, providerPayload: (e.body ?? null) as object | null, updatedAt: new Date() })
        .where(eq(refunds.id, r.id))
        .returning();
      await audit({ actorId: adminId, actorRole: "admin", action: "refund.failed", targetType: "refund", targetId: r.id, after: { reason: e.message } });
      return failed;
    }
    // Unknown error: release the claim so it can be retried.
    await db.update(refunds).set({ status: "approved", updatedAt: new Date() }).where(and(eq(refunds.id, r.id), eq(refunds.status, "processing")));
    throw e;
  }

  // Phase 3: settle.
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(refunds).where(eq(refunds.id, r.id)).for("update");
    if (!locked || locked.status === "completed") return locked ?? r;
    const [updated] = await tx
      .update(refunds)
      .set({ status: "completed", providerRef: String(providerRes.id), providerPayload: providerRes as object, updatedAt: new Date() })
      .where(eq(refunds.id, r.id))
      .returning();

    // Cash leg only; commission/earning reversals were posted by bookings.ts at cancellation/dispute.
    await postLedger(tx, [
      { kind: "refund", amountNgn: `-${r.amountNgn}`, paymentId: payment.id, bookingId: r.bookingId, userId: payment.userId, refundId: r.id, idempotencyKey: `refund:${r.id}:cash`, memo: `Refund to payer (Flutterwave ${providerRes.id})`, createdBy: adminId },
    ]);

    const [{ total }] = await tx.select({ total: sql<string>`coalesce(sum(${refunds.amountNgn}),0)` }).from(refunds).where(and(eq(refunds.paymentId, payment.id), eq(refunds.status, "completed")));
    const fullyRefunded = compareNgn(fromKobo(toKobo(total)), payment.amountNgn) >= 0;
    await tx.update(payments).set({ status: fullyRefunded ? "refunded" : "partially_refunded", updatedAt: new Date() }).where(eq(payments.id, payment.id));

    if (r.bookingId) {
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, r.bookingId)).for("update");
      const cancelledLike = b && ["cancelled_by_student", "cancelled_by_tutor", "no_show_student", "no_show_tutor"].includes(b.status);
      if (b && cancelledLike && fullyRefunded && compareNgn(fromKobo(toKobo(total)), b.amountDueNgn) >= 0) {
        await tx.update(bookings).set({ status: "refunded", updatedAt: new Date() }).where(eq(bookings.id, b.id));
      }
    }

    await audit({ actorId: adminId, actorRole: "admin", action: "refund.completed", targetType: "refund", targetId: r.id, after: { amountNgn: r.amountNgn, providerRef: String(providerRes.id), paymentStatus: fullyRefunded ? "refunded" : "partially_refunded" } }, tx);
    await notify({ userId: payment.userId, type: "refund.completed", title: "Refund sent", body: `₦${Number(r.amountNgn).toLocaleString("en-NG")} is on its way back to the card or account you paid with. Banks can take 3–10 working days to show it.`, href: r.bookingId ? `/dashboard/bookings/${r.bookingId}` : "/dashboard/payments", dedupeKey: `notify:refund:${r.id}:completed` }, tx);
    return updated;
  });
}

export async function listRefunds(opts: { status?: RefundStatus; page?: number; pageSize?: number } = {}) {
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, opts.page ?? 1);
  const where = opts.status ? eq(refunds.status, opts.status) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({ refund: refunds, payment: payments, payerName: users.fullName, payerEmail: users.email })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .innerJoin(users, eq(users.id, payments.userId))
      .where(where)
      .orderBy(desc(refunds.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(refunds).where(where),
  ]);
  return { rows, total: n, page, pageCount: Math.max(1, Math.ceil(n / pageSize)) };
}

/** Refunds attached to a student's payments (for their payments history page). */
export async function listRefundsForUser(userId: string, opts: { page?: number; pageSize?: number } = {}) {
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, opts.page ?? 1);
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({ refund: refunds, paymentReference: payments.reference })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .where(eq(payments.userId, userId))
      .orderBy(desc(refunds.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(refunds).innerJoin(payments, eq(payments.id, refunds.paymentId)).where(eq(payments.userId, userId)),
  ]);
  return { rows, total: n, page, pageCount: Math.max(1, Math.ceil(n / pageSize)) };
}
