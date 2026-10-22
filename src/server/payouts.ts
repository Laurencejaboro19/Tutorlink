import "server-only";
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { payouts, tutorBankAccounts, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { compareNgn, fromKobo, isPositive, ngn, subNgn, toKobo, type Ngn } from "@/lib/money";
import { notify } from "@/lib/notify";
import { DomainError } from "@/lib/result";
import { getSetting } from "@/lib/settings";
import { FlutterwaveError, initiateTransfer } from "./flutterwave";
import { postLedger, tutorBalances } from "./ledger";

/**
 * Payout lifecycle
 *   requested ─(admin approve: ledger `payout` −amount)─▶ approved ─(transfer ok)─▶ initiated ─▶ completed
 *                                                             │                              └─▶ failed (reversing ledger +amount)
 *                                                             └─(transfer refused / provider error)─▶ stays approved, failureReason set
 *   requested ─(tutor/admin cancel)─▶ cancelled (no ledger impact)
 *
 * Nothing is posted to the ledger at request time. The tutor's "available" balance shown in
 * the UI subtracts payouts that are requested/approved/initiated so the same naira cannot be
 * requested twice. Only an approval posts the ledger debit (idempotency key `payout:${id}`).
 */

export type Payout = typeof payouts.$inferSelect;
export type PayoutStatus = Payout["status"];

const IN_FLIGHT: PayoutStatus[] = ["requested", "approved", "initiated"];

export const NIGERIAN_BANKS: { code: string; name: string }[] = [
  { code: "044", name: "Access Bank" },
  { code: "058", name: "Guaranty Trust Bank (GTBank)" },
  { code: "057", name: "Zenith Bank" },
  { code: "011", name: "First Bank of Nigeria" },
  { code: "033", name: "United Bank for Africa (UBA)" },
  { code: "070", name: "Fidelity Bank" },
  { code: "214", name: "First City Monument Bank (FCMB)" },
  { code: "032", name: "Union Bank" },
  { code: "232", name: "Sterling Bank" },
  { code: "221", name: "Stanbic IBTC Bank" },
  { code: "035", name: "Wema Bank" },
  { code: "076", name: "Polaris Bank" },
  { code: "082", name: "Keystone Bank" },
  { code: "050", name: "Ecobank Nigeria" },
  { code: "215", name: "Unity Bank" },
  { code: "030", name: "Heritage Bank" },
  { code: "301", name: "Jaiz Bank" },
  { code: "101", name: "Providus Bank" },
  { code: "100", name: "SunTrust Bank" },
  { code: "102", name: "Titan Trust Bank" },
  { code: "103", name: "Globus Bank" },
  { code: "50211", name: "Kuda Microfinance Bank" },
  { code: "999992", name: "OPay" },
  { code: "999991", name: "PalmPay" },
  { code: "50515", name: "Moniepoint Microfinance Bank" },
];

export function bankByCode(code: string) {
  return NIGERIAN_BANKS.find((b) => b.code === code) ?? null;
}

export function payoutStatusLabel(s: PayoutStatus) {
  const labels: Record<PayoutStatus, string> = {
    requested: "Awaiting approval",
    approved: "Approved",
    initiated: "Transfer in progress",
    completed: "Paid",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return labels[s];
}

function newPayoutReference() {
  return `TL-PO-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/* ---------------- bank details ---------------- */

export async function saveBankAccount(tutorId: string, input: { bankCode: string; accountNumber: string; accountName: string }) {
  const bank = bankByCode(input.bankCode);
  if (!bank) throw new DomainError("Choose a bank from the list.");
  if (!/^\d{10}$/.test(input.accountNumber)) throw new DomainError("Account number must be 10 digits.");
  const accountName = input.accountName.trim();
  if (accountName.length < 3) throw new DomainError("Enter the account name as it appears at your bank.");
  const enc = encryptSecret(input.accountNumber);
  await db.transaction(async (tx) => {
    await tx
      .insert(tutorBankAccounts)
      .values({ tutorId, bankCode: bank.code, bankName: bank.name, accountNumberEnc: enc, accountLast4: input.accountNumber.slice(-4), accountName, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: tutorBankAccounts.tutorId,
        set: { bankCode: bank.code, bankName: bank.name, accountNumberEnc: enc, accountLast4: input.accountNumber.slice(-4), accountName, updatedAt: new Date() },
      });
    await audit({ actorId: tutorId, actorRole: "tutor", action: "payout.bank_account_saved", targetType: "user", targetId: tutorId, after: { bankCode: bank.code, last4: input.accountNumber.slice(-4) } }, tx);
  });
}

/** Masked view for the UI; never returns the full account number. */
export async function getBankAccountMasked(tutorId: string) {
  const row = await db.query.tutorBankAccounts.findFirst({ where: eq(tutorBankAccounts.tutorId, tutorId) });
  if (!row) return null;
  return { bankCode: row.bankCode, bankName: row.bankName, accountLast4: row.accountLast4, accountName: row.accountName, updatedAt: row.updatedAt };
}

/* ---------------- balances ---------------- */

/** Sum of payouts that are requested/approved/initiated. Approved+ are already in the ledger; requested are not. */
async function pendingPayoutTotals(tutorId: string, exec: Tx | typeof db) {
  const rows = await exec
    .select({ status: payouts.status, sum: sql<string>`coalesce(sum(${payouts.amountNgn}),0)` })
    .from(payouts)
    .where(and(eq(payouts.tutorId, tutorId), inArray(payouts.status, IN_FLIGHT)))
    .groupBy(payouts.status);
  const by: Partial<Record<PayoutStatus, bigint>> = {};
  for (const r of rows) by[r.status] = toKobo(r.sum);
  return { requested: fromKobo(by.requested ?? 0n), approved: fromKobo(by.approved ?? 0n), initiated: fromKobo(by.initiated ?? 0n) };
}

/**
 * What a tutor can request right now: ledger available − payouts still in `requested`
 * (approved/initiated ones are already deducted from the ledger by `approvePayout`).
 */
export async function requestableBalance(tutorId: string, tx?: Tx) {
  const exec = tx ?? db;
  const balances = await tutorBalances(tutorId, tx);
  const pending = await pendingPayoutTotals(tutorId, exec);
  const requestable = subNgn(balances.available, pending.requested);
  return { ...balances, pendingRequested: pending.requested, inFlight: fromKobo(toKobo(pending.approved) + toKobo(pending.initiated)), requestable: toKobo(requestable) < 0n ? "0.00" : requestable };
}

/* ---------------- tutor: request / cancel ---------------- */

export async function requestPayout(tutorId: string, amount: Ngn) {
  const amountNgn = ngn(amount);
  if (!isPositive(amountNgn)) throw new DomainError("Enter an amount greater than zero.");
  const min = ngn(await getSetting("payouts.min_amount_ngn"));
  if (compareNgn(amountNgn, min) < 0) throw new DomainError(`The minimum payout is ₦${Number(min).toLocaleString("en-NG")}.`);
  const bank = await db.query.tutorBankAccounts.findFirst({ where: eq(tutorBankAccounts.tutorId, tutorId) });
  if (!bank) throw new DomainError("Add your bank details before requesting a payout.");

  return db.transaction(async (tx) => {
    // Serialise payout requests per tutor so two concurrent requests cannot both pass the balance check.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"payout:" + tutorId}))`);
    const bal = await requestableBalance(tutorId, tx);
    if (compareNgn(amountNgn, bal.requestable) > 0) {
      throw new DomainError(`You can request up to ₦${Number(bal.requestable).toLocaleString("en-NG")} right now (available balance minus payouts already requested).`);
    }
    const [row] = await tx.insert(payouts).values({ tutorId, amountNgn, status: "requested", reference: newPayoutReference() }).returning();
    await audit({ actorId: tutorId, actorRole: "tutor", action: "payout.requested", targetType: "payout", targetId: row.id, after: { amountNgn } }, tx);
    await notify({ userId: tutorId, type: "payout.requested", title: "Payout request received", body: `₦${Number(amountNgn).toLocaleString("en-NG")} will be reviewed by the finance team before any transfer is made.`, href: "/tutor/earnings", dedupeKey: `notify:payout:${row.id}:requested` }, tx);
    return row;
  });
}

/** A tutor may withdraw a request that has not been approved yet. */
export async function cancelPayoutRequest(tutorId: string, payoutId: string) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payouts).where(and(eq(payouts.id, payoutId), eq(payouts.tutorId, tutorId))).for("update");
    if (!p) throw new DomainError("Payout not found.");
    if (p.status !== "requested") throw new DomainError(`This payout is already ${payoutStatusLabel(p.status).toLowerCase()} and can no longer be withdrawn.`);
    const [updated] = await tx.update(payouts).set({ status: "cancelled", failureReason: "Withdrawn by tutor", updatedAt: new Date() }).where(eq(payouts.id, p.id)).returning();
    await audit({ actorId: tutorId, actorRole: "tutor", action: "payout.cancelled", targetType: "payout", targetId: p.id, before: { status: p.status }, after: { status: "cancelled" } }, tx);
    return updated;
  });
}

/* ---------------- admin: approve / execute / settle ---------------- */

/** Posts the ledger debit (idempotent) and moves requested → approved. */
export async function approvePayout(adminId: string, payoutId: string) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).for("update");
    if (!p) throw new DomainError("Payout not found.");
    if (p.status === "approved") return p; // idempotent
    if (p.status !== "requested") throw new DomainError(`Only requested payouts can be approved (this one is ${p.status}).`);
    // Re-check the balance at approval time: refunds may have landed since the request.
    const bal = await tutorBalances(p.tutorId, tx);
    if (compareNgn(p.amountNgn, bal.available) > 0) {
      throw new DomainError(`The tutor's available balance (₦${Number(bal.available).toLocaleString("en-NG")}) no longer covers this payout.`);
    }
    await postLedger(tx, [{ kind: "payout", amountNgn: `-${p.amountNgn}`, tutorId: p.tutorId, payoutId: p.id, idempotencyKey: `payout:${p.id}`, memo: `Payout ${p.reference} approved`, createdBy: adminId }]);
    const [updated] = await tx.update(payouts).set({ status: "approved", approvedBy: adminId, failureReason: null, updatedAt: new Date() }).where(eq(payouts.id, p.id)).returning();
    await audit({ actorId: adminId, actorRole: "admin", action: "payout.approved", targetType: "payout", targetId: p.id, before: { status: p.status }, after: { status: "approved", amountNgn: p.amountNgn } }, tx);
    await notify({ userId: p.tutorId, type: "payout.approved", title: "Payout approved", body: `₦${Number(p.amountNgn).toLocaleString("en-NG")} has been approved and will be transferred to your bank account.`, href: "/tutor/earnings", dedupeKey: `notify:payout:${p.id}:approved` }, tx);
    return updated;
  });
}

/** Reject a requested payout. No ledger impact (nothing was posted yet). */
export async function rejectPayout(adminId: string, payoutId: string, reason: string) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).for("update");
    if (!p) throw new DomainError("Payout not found.");
    if (p.status !== "requested") throw new DomainError(`Only requested payouts can be rejected (this one is ${p.status}).`);
    const [updated] = await tx.update(payouts).set({ status: "cancelled", failureReason: reason.trim() || "Rejected by finance", approvedBy: adminId, updatedAt: new Date() }).where(eq(payouts.id, p.id)).returning();
    await audit({ actorId: adminId, actorRole: "admin", action: "payout.rejected", targetType: "payout", targetId: p.id, after: { reason } }, tx);
    await notify({ userId: p.tutorId, type: "payout.rejected", title: "Payout request not approved", body: reason.trim() || "Your payout request was not approved. Your balance is unchanged.", href: "/tutor/earnings", dedupeKey: `notify:payout:${p.id}:rejected` }, tx);
    return updated;
  });
}

/**
 * Calls Flutterwave transfers for an approved payout. On success → initiated + providerRef.
 * On FlutterwaveError (including PAYOUTS_ENABLED unset) the payout stays approved with the
 * reason recorded; no ledger change in either case (the debit was posted at approval).
 */
export async function executePayout(adminId: string, payoutId: string) {
  const p = await db.query.payouts.findFirst({ where: eq(payouts.id, payoutId) });
  if (!p) throw new DomainError("Payout not found.");
  if (p.status !== "approved") throw new DomainError(`Only approved payouts can be sent (this one is ${p.status}).`);
  const bank = await db.query.tutorBankAccounts.findFirst({ where: eq(tutorBankAccounts.tutorId, p.tutorId) });
  if (!bank) throw new DomainError("The tutor has no bank details on file.");
  const tutor = await db.query.users.findFirst({ where: eq(users.id, p.tutorId) });

  let accountNumber: string;
  try {
    accountNumber = decryptSecret(bank.accountNumberEnc);
  } catch {
    throw new DomainError("Stored bank details could not be decrypted (AUTH_SECRET rotated?). Ask the tutor to re-enter them.");
  }

  try {
    const res = await initiateTransfer({
      bankCode: bank.bankCode,
      accountNumber,
      amount: p.amountNgn,
      narration: `TutorLink payout ${p.reference}`,
      reference: p.reference,
      beneficiaryName: bank.accountName || tutor?.fullName || "TutorLink tutor",
    });
    return db.transaction(async (tx) => {
      const [locked] = await tx.select().from(payouts).where(eq(payouts.id, p.id)).for("update");
      if (!locked || locked.status !== "approved") return locked ?? p;
      const [updated] = await tx
        .update(payouts)
        .set({ status: "initiated", providerRef: String(res.id), providerPayload: res as object, failureReason: null, updatedAt: new Date() })
        .where(eq(payouts.id, p.id))
        .returning();
      await audit({ actorId: adminId, actorRole: "admin", action: "payout.initiated", targetType: "payout", targetId: p.id, after: { providerRef: String(res.id), providerStatus: res.status } }, tx);
      return updated;
    });
  } catch (e) {
    if (e instanceof FlutterwaveError) {
      const [updated] = await db.update(payouts).set({ failureReason: e.message, updatedAt: new Date() }).where(and(eq(payouts.id, p.id), eq(payouts.status, "approved"))).returning();
      await audit({ actorId: adminId, actorRole: "admin", action: "payout.transfer_refused", targetType: "payout", targetId: p.id, after: { reason: e.message } });
      return updated ?? p;
    }
    throw e;
  }
}

/** Provider confirmed the transfer (webhook or admin reconciliation). */
export async function markPayoutCompleted(actorId: string | null, payoutId: string, providerPayload?: unknown) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).for("update");
    if (!p) throw new DomainError("Payout not found.");
    if (p.status === "completed") return p;
    if (p.status !== "initiated" && p.status !== "approved") throw new DomainError(`A ${p.status} payout cannot be marked completed.`);
    const [updated] = await tx
      .update(payouts)
      .set({ status: "completed", providerPayload: (providerPayload ?? p.providerPayload) as object | null, failureReason: null, updatedAt: new Date() })
      .where(eq(payouts.id, p.id))
      .returning();
    await audit({ actorId, actorRole: actorId ? "admin" : "system", action: "payout.completed", targetType: "payout", targetId: p.id, before: { status: p.status } }, tx);
    await notify({ userId: p.tutorId, type: "payout.completed", title: "Payout sent", body: `₦${Number(p.amountNgn).toLocaleString("en-NG")} was transferred to your bank account.`, href: "/tutor/earnings", dedupeKey: `notify:payout:${p.id}:completed` }, tx);
    return updated;
  });
}

/** Transfer failed/reversed at the provider: reverse the ledger debit (idempotent) and mark failed. */
export async function markPayoutFailed(actorId: string | null, payoutId: string, reason: string, providerPayload?: unknown) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).for("update");
    if (!p) throw new DomainError("Payout not found.");
    if (p.status === "failed") return p;
    if (p.status !== "initiated" && p.status !== "approved") throw new DomainError(`A ${p.status} payout cannot be marked failed.`);
    // The debit was posted at approval; return the money to the tutor's balance.
    await postLedger(tx, [{ kind: "payout", amountNgn: p.amountNgn, tutorId: p.tutorId, payoutId: p.id, idempotencyKey: `payout:${p.id}:reversal`, memo: `Payout ${p.reference} failed: ${reason}`, createdBy: actorId }]);
    const [updated] = await tx
      .update(payouts)
      .set({ status: "failed", failureReason: reason, providerPayload: (providerPayload ?? p.providerPayload) as object | null, updatedAt: new Date() })
      .where(eq(payouts.id, p.id))
      .returning();
    await audit({ actorId, actorRole: actorId ? "admin" : "system", action: "payout.failed", targetType: "payout", targetId: p.id, before: { status: p.status }, after: { reason } }, tx);
    await notify({ userId: p.tutorId, type: "payout.failed", title: "Payout could not be completed", body: `${reason} The amount has been returned to your available balance.`, href: "/tutor/earnings", dedupeKey: `notify:payout:${p.id}:failed` }, tx);
    return updated;
  });
}

/* ---------------- queries ---------------- */

export async function listTutorPayouts(tutorId: string, opts: { page?: number; pageSize?: number } = {}) {
  const pageSize = opts.pageSize ?? 10;
  const page = Math.max(1, opts.page ?? 1);
  const [rows, [{ n }]] = await Promise.all([
    db.select().from(payouts).where(eq(payouts.tutorId, tutorId)).orderBy(desc(payouts.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(payouts).where(eq(payouts.tutorId, tutorId)),
  ]);
  return { rows, total: n, page, pageCount: Math.max(1, Math.ceil(n / pageSize)) };
}

export async function listPayouts(opts: { status?: PayoutStatus; page?: number; pageSize?: number } = {}) {
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, opts.page ?? 1);
  const where = opts.status ? eq(payouts.status, opts.status) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({ payout: payouts, tutorName: users.fullName, tutorEmail: users.email })
      .from(payouts)
      .innerJoin(users, eq(users.id, payouts.tutorId))
      .where(where)
      .orderBy(desc(payouts.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(payouts).where(where),
  ]);
  return { rows, total: n, page, pageCount: Math.max(1, Math.ceil(n / pageSize)) };
}
