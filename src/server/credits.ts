import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { creditEntries } from "@/db/schema";
import { fromKobo, toKobo, type Ngn } from "@/lib/money";
import { DomainError } from "@/lib/result";

/**
 * Platform credit ledger. Balances are never stored as an editable number —
 * they are the sum of `available` entries. Every entry carries an idempotency
 * key so a replayed event cannot credit twice. Credits are not cash and are
 * only redeemable against bookings (see bookings service).
 */

export async function creditBalance(userId: string, tx?: Tx): Promise<Ngn> {
  const exec = tx ?? db;
  const [row] = await exec
    .select({ sum: sql<string>`coalesce(sum(${creditEntries.amountNgn}), 0)` })
    .from(creditEntries)
    .where(and(eq(creditEntries.userId, userId), eq(creditEntries.status, "available")));
  return fromKobo(toKobo(row?.sum ?? "0"));
}

export async function issueCredit(
  input: {
    userId: string;
    amountNgn: Ngn;
    type: "referral" | "challenge_reward" | "leaderboard_reward" | "promotional" | "adjustment";
    source: string;
    reason: string;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey: string;
    expiresAt?: Date | null;
    createdBy?: string | null;
  },
  tx?: Tx,
) {
  if (toKobo(input.amountNgn) <= 0n) throw new DomainError("Credit amount must be positive.");
  const exec = tx ?? db;
  const [row] = await exec
    .insert(creditEntries)
    .values({
      userId: input.userId,
      amountNgn: input.amountNgn,
      type: input.type,
      status: "available",
      source: input.source,
      reason: input.reason,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt ?? null,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoNothing({ target: creditEntries.idempotencyKey })
    .returning();
  return row ?? null; // null = already issued (idempotent)
}

/**
 * Redeem credits against a booking. Must run inside the booking transaction so
 * the balance check and the debit are atomic (row lock on the user's entries via
 * SELECT ... FOR UPDATE pattern on an advisory lock).
 */
export async function redeemCredit(
  tx: Tx,
  input: { userId: string; amountNgn: Ngn; bookingId: string; idempotencyKey: string },
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"credits:" + input.userId}))`);
  const balance = await creditBalance(input.userId, tx);
  if (toKobo(balance) < toKobo(input.amountNgn)) throw new DomainError("Insufficient credit balance.");
  const [row] = await tx
    .insert(creditEntries)
    .values({
      userId: input.userId,
      amountNgn: fromKobo(-toKobo(input.amountNgn)),
      type: "redemption",
      status: "available",
      source: "booking",
      reason: "Applied to booking",
      referenceType: "booking",
      referenceId: input.bookingId,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: creditEntries.idempotencyKey })
    .returning();
  return row ?? null;
}

/** Reverse a redemption (e.g. booking expired unpaid or refunded). */
export async function reverseRedemption(tx: Tx, input: { userId: string; amountNgn: Ngn; bookingId: string; idempotencyKey: string; reason: string }) {
  const [row] = await tx
    .insert(creditEntries)
    .values({
      userId: input.userId,
      amountNgn: input.amountNgn,
      type: "reversal",
      status: "available",
      source: "booking",
      reason: input.reason,
      referenceType: "booking",
      referenceId: input.bookingId,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: creditEntries.idempotencyKey })
    .returning();
  return row ?? null;
}

/** Admin reversal of a previously issued credit (fraud). */
export async function reverseCredit(tx: Tx, input: { entryId: string; adminId: string; reason: string }) {
  const entry = await tx.query.creditEntries.findFirst({ where: eq(creditEntries.id, input.entryId) });
  if (!entry) throw new DomainError("Credit entry not found.");
  if (entry.status !== "available" || toKobo(entry.amountNgn) <= 0n) throw new DomainError("Only available positive credits can be reversed.");
  await tx.update(creditEntries).set({ status: "reversed" }).where(eq(creditEntries.id, entry.id));
  const [row] = await tx
    .insert(creditEntries)
    .values({
      userId: entry.userId,
      amountNgn: fromKobo(-toKobo(entry.amountNgn)),
      type: "reversal",
      status: "available",
      source: "admin",
      reason: input.reason,
      referenceType: "credit_entry",
      referenceId: entry.id,
      idempotencyKey: `reverse:${entry.id}`,
      createdBy: input.adminId,
    })
    .onConflictDoNothing({ target: creditEntries.idempotencyKey })
    .returning();
  return row ?? null;
}
