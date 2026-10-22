import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { fromKobo, toKobo, type Ngn } from "@/lib/money";

/**
 * Append-only financial ledger. Kinds and sign conventions (NGN):
 *   payment_received    +amount   money collected from a payer (payment bucket)
 *   processing_fee      -fee      provider fee charged on the payment (platform bucket)
 *   platform_commission +amount   platform's share of a booking (platform bucket)
 *   tutor_earning       +amount   tutor's share of a booking (tutor bucket, tutorId set)
 *   refund              -amount   money returned to payer; paired with negative commission/earning rows
 *   payout              -amount   paid out to tutor (tutor bucket)
 *   adjustment          ±amount   explicit admin correction, memo required
 * Each row has an idempotencyKey; replays are no-ops.
 */
export type LedgerKind = (typeof ledgerEntries.$inferInsert)["kind"];

export async function postLedger(
  tx: Tx,
  rows: Array<{
    kind: LedgerKind;
    amountNgn: Ngn;
    paymentId?: string | null;
    bookingId?: string | null;
    subscriptionId?: string | null;
    tutorId?: string | null;
    userId?: string | null;
    refundId?: string | null;
    payoutId?: string | null;
    memo?: string;
    idempotencyKey: string;
    createdBy?: string | null;
  }>,
) {
  if (!rows.length) return [];
  return tx
    .insert(ledgerEntries)
    .values(rows.map((r) => ({ ...r, currency: "NGN" })))
    .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
    .returning();
}

/** Tutor balance available for payout = earnings − refunds of earnings − payouts (completed or in flight). */
export async function tutorBalances(tutorId: string, tx?: Tx) {
  const exec = tx ?? db;
  const rows = await exec
    .select({ kind: ledgerEntries.kind, sum: sql<string>`coalesce(sum(${ledgerEntries.amountNgn}),0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.tutorId, tutorId), inArray(ledgerEntries.kind, ["tutor_earning", "refund", "payout", "adjustment"])))
    .groupBy(ledgerEntries.kind);
  const by = Object.fromEntries(rows.map((r) => [r.kind, toKobo(r.sum)])) as Record<string, bigint>;
  const earned = by.tutor_earning ?? 0n;
  const refunded = by.refund ?? 0n; // negative
  const paidOut = by.payout ?? 0n; // negative
  const adjusted = by.adjustment ?? 0n;
  return {
    lifetimeEarnings: fromKobo(earned),
    refunded: fromKobo(-refunded),
    paidOut: fromKobo(-paidOut),
    available: fromKobo(earned + refunded + paidOut + adjusted),
  };
}

export async function platformTotals(tx?: Tx) {
  const exec = tx ?? db;
  const rows = await exec
    .select({ kind: ledgerEntries.kind, sum: sql<string>`coalesce(sum(${ledgerEntries.amountNgn}),0)` })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.kind);
  return Object.fromEntries(rows.map((r) => [r.kind, fromKobo(toKobo(r.sum))])) as Partial<Record<LedgerKind, Ngn>>;
}
