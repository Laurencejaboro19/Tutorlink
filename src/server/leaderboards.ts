import "server-only";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { bookings, cities, creditEntries, leaderboardCycles, leaderboardResults, states, studentRewards, subjects, tutorProfiles, tutorRewards, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { addNgn, compareNgn, ngn, type Ngn } from "@/lib/money";
import { notify } from "@/lib/notify";
import { DomainError } from "@/lib/result";
import { getSetting, getSettings } from "@/lib/settings";
import { addDays, platformDay, platformDayStart } from "@/lib/time";
import { MIN_VALID_DURATION_SECONDS } from "./challenges";
import { issueCredit, reverseCredit } from "./credits";
import { getActivePlan, type PlanCode } from "./plans";
import { grantPromotionalMonth } from "./subscriptions";

/**
 * Leaderboard cycles, standings and reward distribution.
 *
 * Standings (live and finalized) count only attempts with status `submitted`, finished in
 * ≥ 5 seconds (anti-abuse), on published challenges, submitted inside the cycle window.
 * Points = Σ best score per challenge per user; ties break by correct answers, then shorter
 * total time, then earlier first submission, then user id — fully deterministic.
 *
 * Student rewards (top N eligible on the nationwide board, N and value from settings):
 *   cash   — the student completed a paid session (paymentId set, price ≥ cash_min_paid_session_ngn)
 *            whose completedAt falls inside the cycle. Inserted as `pending_review`; finance
 *            approves, collects/validates bank details and marks paid. Never auto-paid.
 *            (Students have no `tutor_bank_accounts` row, so bank details are not a precondition
 *            here — they are verified by finance at approval time.)
 *   credit — everyone else: a `leaderboard_reward` credit entry, idempotent on `reward:<cycle>:<user>`.
 * Rewards stop when the cycle budget is exhausted (remaining winners recorded as `rejected`).
 *
 * Tutor engagement rewards: score = 1.0·uniqueParticipants + 2.0·completions + 1.5·repeatParticipants
 * + 10·completionRate, over engagement_events in the cycle for published challenges. Events by
 * the creator themself are excluded, as are events from accounts created < 7 days before cycle
 * end with ≤ 1 attempt in total (a cheap fake-account heuristic — documented, tunable later).
 * Best eligible Free-plan tutor → one month of Premium; best eligible Premium tutor → one month
 * of Premium+ (both `pending_review`, granted on admin approval). Premium+ tutors are recognised
 * only, so no tutor_rewards row is written for them.
 */

export type Cycle = typeof leaderboardCycles.$inferSelect;
export type Scope = "nationwide" | "state" | "city" | "subject";

export type StandingRow = {
  rank: number;
  userId: string;
  displayName: string;
  city: string | null;
  state: string | null;
  points: number;
  correctCount: number;
  attemptsCount: number;
  totalDurationSeconds: number;
  firstSubmissionAt: Date | null;
};

export const REWARD_STATUS_LABEL: Record<typeof studentRewards.$inferSelect.status, string> = {
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Not awarded",
  credited: "Credited",
  payout_initiated: "Payout in progress",
  paid: "Paid",
  failed: "Payout failed",
  reversed: "Reversed",
};

export const CYCLE_STATUS_LABEL: Record<Cycle["status"], string> = { open: "Open", finalized: "Finalized", rewarded: "Rewarded" };

/* ------------------------------------------------------------------ */
/* Cycles                                                              */
/* ------------------------------------------------------------------ */

export async function getCurrentCycle(now = new Date()) {
  return (await db.query.leaderboardCycles.findFirst({ where: and(lte(leaderboardCycles.startsAt, now), gt(leaderboardCycles.endsAt, now)), orderBy: desc(leaderboardCycles.startsAt) })) ?? null;
}

/**
 * Make sure a cycle covers `now`. Starts at today's platform-day start, or exactly at the
 * previous cycle's end when that end is less than a day ago (contiguous cycles). Idempotent:
 * startsAt is unique, so concurrent callers converge on one row.
 */
export async function ensureOpenCycle(now = new Date()): Promise<Cycle> {
  const covering = await getCurrentCycle(now);
  if (covering) return covering;
  const last = await db.query.leaderboardCycles.findFirst({ orderBy: desc(leaderboardCycles.endsAt) });
  let startsAt = platformDayStart(platformDay(now));
  if (last && last.endsAt <= now && now.getTime() - last.endsAt.getTime() < 86_400_000) startsAt = last.endsAt;
  if (last && last.endsAt > startsAt) startsAt = last.endsAt; // never overlap an existing cycle
  const durationDays = await getSetting("leaderboard.cycle_days");
  const budgetNgn = ngn(await getSetting("leaderboard.cycle_budget_ngn"));
  const [row] = await db
    .insert(leaderboardCycles)
    .values({ startsAt, endsAt: addDays(startsAt, durationDays), durationDays, budgetNgn, status: "open" })
    .onConflictDoNothing({ target: leaderboardCycles.startsAt })
    .returning();
  if (row) return row;
  const existing = await db.query.leaderboardCycles.findFirst({ where: eq(leaderboardCycles.startsAt, startsAt) });
  if (!existing) throw new Error("Cycle insert raced and the row is missing");
  return existing;
}

export async function getCycle(id: string) {
  return (await db.query.leaderboardCycles.findFirst({ where: eq(leaderboardCycles.id, id) })) ?? null;
}

export const CYCLES_PAGE_SIZE = 12;

/** Past (finalized/rewarded) cycles, newest first. */
export async function listPastCycles(page = 1, pageSize = CYCLES_PAGE_SIZE) {
  const where = inArray(leaderboardCycles.status, ["finalized", "rewarded"]);
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(leaderboardCycles).where(where),
    db.select().from(leaderboardCycles).where(where).orderBy(desc(leaderboardCycles.startsAt)).limit(pageSize).offset((page - 1) * pageSize),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/* ------------------------------------------------------------------ */
/* Standings                                                           */
/* ------------------------------------------------------------------ */

function scopeFilter(scope: Scope, scopeKey: string) {
  if (scope === "nationwide") return sql``;
  const key = Number(scopeKey);
  if (!Number.isInteger(key)) throw new DomainError("Invalid scope key.");
  if (scope === "state") return sql`and u.state_id = ${key}`;
  if (scope === "city") return sql`and u.city_id = ${key}`;
  return sql`and c.subject_id = ${key}`;
}

/** Ranked standings for a cycle window + scope, as a SQL fragment usable as a subquery. */
function rankedSql(cycle: { startsAt: Date; endsAt: Date }, scope: Scope, scopeKey: string) {
  return sql`
    with valid as (
      select a.user_id, a.challenge_id, a.score, a.correct_count, coalesce(a.duration_seconds, 0) as duration_seconds, a.submitted_at
      from attempts a
      join challenges c on c.id = a.challenge_id
      join users u on u.id = a.user_id
      where a.status = 'submitted'
        and a.submitted_at >= ${cycle.startsAt} and a.submitted_at < ${cycle.endsAt}
        and coalesce(a.duration_seconds, 0) >= ${MIN_VALID_DURATION_SECONDS}
        and c.status in ('published', 'archived')
        and u.deleted_at is null
        ${scopeFilter(scope, scopeKey)}
    ),
    best as (
      select distinct on (user_id, challenge_id) user_id, challenge_id, score, correct_count, duration_seconds, submitted_at
      from valid
      order by user_id, challenge_id, score desc, correct_count desc, duration_seconds asc, submitted_at asc
    ),
    agg as (
      select b.user_id,
        sum(b.score)::int as points,
        sum(b.correct_count)::int as correct_count,
        sum(b.duration_seconds)::int as total_duration_seconds,
        (select min(v.submitted_at) from valid v where v.user_id = b.user_id) as first_submission_at,
        (select count(*)::int from valid v where v.user_id = b.user_id) as attempts_count
      from best b
      group by b.user_id
    )
    select agg.user_id, agg.points, agg.correct_count, agg.total_duration_seconds, agg.first_submission_at, agg.attempts_count,
      (row_number() over (order by agg.points desc, agg.correct_count desc, agg.total_duration_seconds asc, agg.first_submission_at asc, agg.user_id asc))::int as rank,
      coalesce(u.display_name, split_part(u.full_name, ' ', 1)) as display_name,
      ci.name as city, st.name as state
    from agg
    join users u on u.id = agg.user_id
    left join cities ci on ci.id = u.city_id
    left join states st on st.id = u.state_id
  `;
}

type RawStanding = { user_id: string; points: number; correct_count: number; total_duration_seconds: number; first_submission_at: Date | null; attempts_count: number; rank: number; display_name: string; city: string | null; state: string | null };

function toStanding(r: RawStanding): StandingRow {
  return {
    rank: Number(r.rank),
    userId: r.user_id,
    displayName: r.display_name,
    city: r.city,
    state: r.state,
    points: Number(r.points),
    correctCount: Number(r.correct_count),
    attemptsCount: Number(r.attempts_count),
    totalDurationSeconds: Number(r.total_duration_seconds),
    firstSubmissionAt: r.first_submission_at ? new Date(r.first_submission_at) : null,
  };
}

export async function liveStandings(opts: { scope: Scope; scopeKey?: string; cycleId: string; limit?: number; page?: number }, tx?: Tx) {
  const exec = tx ?? db;
  const cycle = await exec.query.leaderboardCycles.findFirst({ where: eq(leaderboardCycles.id, opts.cycleId) });
  if (!cycle) throw new DomainError("Cycle not found.");
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  const ranked = rankedSql(cycle, opts.scope, opts.scopeKey ?? "all");
  const [rows, totalRes] = await Promise.all([
    exec.execute<RawStanding>(sql`select * from (${ranked}) r order by r.rank limit ${limit} offset ${(page - 1) * limit}`),
    exec.execute<{ n: number }>(sql`select count(*)::int as n from (${ranked}) r`),
  ]);
  const total = Number(totalRes.rows[0]?.n ?? 0);
  return { rows: rows.rows.map(toStanding), total, page, pageCount: Math.max(1, Math.ceil(total / limit)), cycle };
}

/** One user's live position in a scope (null if they have no counted attempt). */
export async function userStanding(opts: { scope: Scope; scopeKey?: string; cycleId: string; userId: string }, tx?: Tx): Promise<StandingRow | null> {
  const exec = tx ?? db;
  const cycle = await exec.query.leaderboardCycles.findFirst({ where: eq(leaderboardCycles.id, opts.cycleId) });
  if (!cycle) return null;
  const ranked = rankedSql(cycle, opts.scope, opts.scopeKey ?? "all");
  const res = await exec.execute<RawStanding>(sql`select * from (${ranked}) r where r.user_id = ${opts.userId}`);
  return res.rows[0] ? toStanding(res.rows[0]) : null;
}

/** Finalized results for a cycle/scope (from leaderboard_results). */
export async function cycleResults(opts: { cycleId: string; scope: Scope; scopeKey?: string; limit?: number; page?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  const where = and(eq(leaderboardResults.cycleId, opts.cycleId), eq(leaderboardResults.scope, opts.scope), eq(leaderboardResults.scopeKey, opts.scopeKey ?? "all"));
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(leaderboardResults).where(where),
    db
      .select({
        rank: leaderboardResults.rank,
        userId: leaderboardResults.userId,
        displayName: sql<string>`coalesce(${users.displayName}, split_part(${users.fullName}, ' ', 1))`,
        city: cities.name,
        state: states.name,
        points: leaderboardResults.points,
        correctCount: leaderboardResults.correctCount,
        attemptsCount: leaderboardResults.attemptsCount,
        totalDurationSeconds: leaderboardResults.totalDurationSeconds,
        firstSubmissionAt: leaderboardResults.firstSubmissionAt,
      })
      .from(leaderboardResults)
      .innerJoin(users, eq(users.id, leaderboardResults.userId))
      .leftJoin(cities, eq(cities.id, users.cityId))
      .leftJoin(states, eq(states.id, users.stateId))
      .where(where)
      .orderBy(asc(leaderboardResults.rank))
      .limit(limit)
      .offset((page - 1) * limit),
  ]);
  return { rows: rows as StandingRow[], total, page, pageCount: Math.max(1, Math.ceil(total / limit)) };
}

/** Subject scopes that exist in a finalized cycle (for the history page selector). */
export async function cycleSubjectScopes(cycleId: string) {
  return db
    .selectDistinct({ id: subjects.id, name: subjects.name })
    .from(leaderboardResults)
    .innerJoin(subjects, sql`${subjects.id} = ${leaderboardResults.scopeKey}::int`)
    .where(and(eq(leaderboardResults.cycleId, cycleId), eq(leaderboardResults.scope, "subject")))
    .orderBy(asc(subjects.name));
}

/** Subjects with at least one counted attempt in the live cycle. */
export async function liveSubjectScopes(cycleId: string) {
  const cycle = await getCycle(cycleId);
  if (!cycle) return [];
  const res = await db.execute<{ id: number; name: string }>(sql`
    select distinct s.id, s.name from attempts a
    join challenges c on c.id = a.challenge_id
    join subjects s on s.id = c.subject_id
    where a.status = 'submitted' and a.submitted_at >= ${cycle.startsAt} and a.submitted_at < ${cycle.endsAt}
    order by s.name`);
  return res.rows;
}

/* ------------------------------------------------------------------ */
/* Finalization                                                        */
/* ------------------------------------------------------------------ */

/**
 * Freeze standings for every scope with ≥ 1 participant. Only after endsAt and only once:
 * a second call returns without writing (status check + unique index on results).
 */
export async function finalizeCycle(cycleId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [cycle] = await tx.select().from(leaderboardCycles).where(eq(leaderboardCycles.id, cycleId)).for("update");
    if (!cycle) throw new DomainError("Cycle not found.");
    if (cycle.status !== "open") return { cycle, inserted: 0, scopes: 0, alreadyFinalized: true };
    if (cycle.endsAt > now) throw new DomainError("This cycle has not ended yet.");

    const keys = await tx.execute<{ kind: string; key: string }>(sql`
      select distinct 'state' as kind, u.state_id::text as key from attempts a join users u on u.id = a.user_id join challenges c on c.id = a.challenge_id
        where a.status = 'submitted' and a.submitted_at >= ${cycle.startsAt} and a.submitted_at < ${cycle.endsAt} and coalesce(a.duration_seconds,0) >= ${MIN_VALID_DURATION_SECONDS} and u.state_id is not null
      union
      select distinct 'city', u.city_id::text from attempts a join users u on u.id = a.user_id join challenges c on c.id = a.challenge_id
        where a.status = 'submitted' and a.submitted_at >= ${cycle.startsAt} and a.submitted_at < ${cycle.endsAt} and coalesce(a.duration_seconds,0) >= ${MIN_VALID_DURATION_SECONDS} and u.city_id is not null
      union
      select distinct 'subject', c.subject_id::text from attempts a join users u on u.id = a.user_id join challenges c on c.id = a.challenge_id
        where a.status = 'submitted' and a.submitted_at >= ${cycle.startsAt} and a.submitted_at < ${cycle.endsAt} and coalesce(a.duration_seconds,0) >= ${MIN_VALID_DURATION_SECONDS} and c.subject_id is not null`);
    const scopes: { scope: Scope; key: string }[] = [{ scope: "nationwide", key: "all" }, ...keys.rows.map((r) => ({ scope: r.kind as Scope, key: r.key }))];

    let inserted = 0;
    for (const s of scopes) {
      const res = await tx.execute<RawStanding>(sql`select * from (${rankedSql(cycle, s.scope, s.key)}) r order by r.rank`);
      const rows = res.rows.map(toStanding);
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r) => ({
          cycleId: cycle.id,
          scope: s.scope,
          scopeKey: s.key,
          userId: r.userId,
          rank: r.rank,
          points: r.points,
          correctCount: r.correctCount,
          attemptsCount: r.attemptsCount,
          totalDurationSeconds: r.totalDurationSeconds,
          firstSubmissionAt: r.firstSubmissionAt,
        }));
        if (chunk.length) {
          const ins = await tx.insert(leaderboardResults).values(chunk).onConflictDoNothing().returning({ id: leaderboardResults.id });
          inserted += ins.length;
        }
      }
    }
    const [updated] = await tx.update(leaderboardCycles).set({ status: "finalized", finalizedAt: now }).where(eq(leaderboardCycles.id, cycle.id)).returning();
    await audit({ actorId: null, actorRole: "system", action: "leaderboard.finalize", targetType: "leaderboard_cycle", targetId: cycle.id, after: { inserted, scopes: scopes.length } }, tx);
    return { cycle: updated, inserted, scopes: scopes.length, alreadyFinalized: false };
  });
}

/* ------------------------------------------------------------------ */
/* Student rewards                                                     */
/* ------------------------------------------------------------------ */

async function qualifyingPaidSession(tx: Tx, userId: string, cycle: Cycle, minNgn: Ngn) {
  const [b] = await tx
    .select({ id: bookings.id, priceNgn: bookings.priceNgn, completedAt: bookings.completedAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.studentId, userId),
        eq(bookings.status, "completed"),
        isNotNull(bookings.paymentId),
        sql`${bookings.completedAt} >= ${cycle.startsAt}`,
        sql`${bookings.completedAt} < ${cycle.endsAt}`,
        sql`${bookings.priceNgn} >= ${minNgn}::numeric`,
      ),
    )
    .orderBy(asc(bookings.completedAt))
    .limit(1);
  return b ?? null;
}

async function issueRewardCredit(tx: Tx, reward: typeof studentRewards.$inferSelect, cycle: Cycle, actorId: string | null) {
  const expiryDays = await getSetting("referral.credit_expiry_days");
  const credit = await issueCredit(
    {
      userId: reward.userId,
      amountNgn: reward.amountNgn,
      type: "leaderboard_reward",
      source: "leaderboard",
      reason: `Leaderboard reward — rank #${reward.rank}, cycle ending ${platformDay(cycle.endsAt)}`,
      referenceType: "student_reward",
      referenceId: reward.id,
      idempotencyKey: `reward:${cycle.id}:${reward.userId}`,
      expiresAt: new Date(Date.now() + expiryDays * 86_400_000),
      createdBy: actorId,
    },
    tx,
  );
  const creditId = credit?.id ?? (await tx.query.creditEntries.findFirst({ where: eq(creditEntries.idempotencyKey, `reward:${cycle.id}:${reward.userId}`) }))?.id ?? null;
  await tx.update(studentRewards).set({ status: "credited", creditEntryId: creditId, reviewedBy: actorId, updatedAt: new Date() }).where(eq(studentRewards.id, reward.id));
  return creditId;
}

/**
 * Distribute student rewards for a finalized cycle, then tutor engagement rewards.
 * Idempotent: a rewarded cycle returns immediately; per-user rows are unique per cycle.
 */
export async function distributeRewards(cycleId: string) {
  const s = await getSettings(["leaderboard.top_n", "leaderboard.reward_ngn", "leaderboard.min_attempts_for_eligibility", "leaderboard.cash_requires_paid_session_in_cycle", "leaderboard.cash_min_paid_session_ngn"]);
  const reward = ngn(s["leaderboard.reward_ngn"]);
  const minPaid = ngn(s["leaderboard.cash_min_paid_session_ngn"]);
  return db.transaction(async (tx) => {
    const [cycle] = await tx.select().from(leaderboardCycles).where(eq(leaderboardCycles.id, cycleId)).for("update");
    if (!cycle) throw new DomainError("Cycle not found.");
    if (cycle.status === "rewarded") return { cycle, rewarded: 0, cash: 0, credit: 0, rejected: 0, tutorRewards: 0, alreadyRewarded: true };
    if (cycle.status !== "finalized") throw new DomainError("Finalize the cycle before distributing rewards.");

    const board = await tx
      .select()
      .from(leaderboardResults)
      .where(and(eq(leaderboardResults.cycleId, cycle.id), eq(leaderboardResults.scope, "nationwide"), eq(leaderboardResults.scopeKey, "all")))
      .orderBy(asc(leaderboardResults.rank));
    const winners = board.filter((r) => r.attemptsCount >= s["leaderboard.min_attempts_for_eligibility"]).slice(0, s["leaderboard.top_n"]);

    // Budget already committed (reruns after a partial failure).
    const existing = await tx.select().from(studentRewards).where(eq(studentRewards.cycleId, cycle.id));
    let spent: Ngn = existing.filter((r) => r.status !== "rejected").reduce((acc, r) => addNgn(acc, r.amountNgn), "0.00");
    let cash = 0;
    let credit = 0;
    let rejected = 0;

    for (const w of winners) {
      if (existing.some((r) => r.userId === w.userId)) continue;
      const overBudget = compareNgn(addNgn(spent, reward), cycle.budgetNgn) > 0;
      if (overBudget) {
        await tx
          .insert(studentRewards)
          .values({ cycleId: cycle.id, userId: w.userId, rank: w.rank, kind: "credit", amountNgn: reward, status: "rejected", eligibilityNote: "budget exhausted" })
          .onConflictDoNothing();
        rejected++;
        continue;
      }
      const paid = s["leaderboard.cash_requires_paid_session_in_cycle"] ? await qualifyingPaidSession(tx, w.userId, cycle, minPaid) : { id: null, priceNgn: null };
      const kind: "cash" | "credit" = paid ? "cash" : "credit";
      const [row] = await tx
        .insert(studentRewards)
        .values({
          cycleId: cycle.id,
          userId: w.userId,
          rank: w.rank,
          kind,
          amountNgn: reward,
          status: "pending_review",
          eligibilityNote: paid
            ? paid.id
              ? `Cash: qualifying paid session ${paid.id} (₦${paid.priceNgn}) completed in cycle. Finance verifies bank details before payout.`
              : "Cash: paid-session requirement disabled by settings."
            : `Credit: no paid session of ₦${minPaid} or more completed during the cycle.`,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) continue;
      spent = addNgn(spent, reward);
      if (kind === "credit") {
        await issueRewardCredit(tx, row, cycle, null);
        credit++;
      } else {
        cash++;
      }
      await notify(
        {
          userId: w.userId,
          type: "reward.leaderboard",
          title: `You finished #${w.rank} on the leaderboard`,
          body: kind === "credit" ? `₦${Number(reward).toLocaleString()} platform credit has been added to your account.` : `A ₦${Number(reward).toLocaleString()} cash reward is being reviewed by our finance team.`,
          href: "/dashboard/credits",
          dedupeKey: `notify:reward:${cycle.id}:${w.userId}`,
        },
        tx,
      );
    }

    const tutorCount = await distributeTutorRewards(cycle, tx);
    const [updated] = await tx.update(leaderboardCycles).set({ status: "rewarded", rewardedAt: new Date() }).where(eq(leaderboardCycles.id, cycle.id)).returning();
    await audit({ actorId: null, actorRole: "system", action: "leaderboard.distribute_rewards", targetType: "leaderboard_cycle", targetId: cycle.id, after: { cash, credit, rejected, tutorRewards: tutorCount, spent } }, tx);
    return { cycle: updated, rewarded: cash + credit, cash, credit, rejected, tutorRewards: tutorCount, alreadyRewarded: false };
  });
}

/* ------------------------------------------------------------------ */
/* Tutor engagement rewards                                            */
/* ------------------------------------------------------------------ */

export type EngagementScore = {
  creatorId: string;
  uniqueParticipants: number;
  starts: number;
  completions: number;
  repeatParticipants: number;
  completionRate: number; // 0–1
  score: number;
};

export function engagementScore(c: { uniqueParticipants: number; completions: number; repeatParticipants: number; completionRate: number }) {
  return 1.0 * c.uniqueParticipants + 2.0 * c.completions + 1.5 * c.repeatParticipants + 10 * c.completionRate;
}

/** Engagement per creator over a window, with the fake-account heuristic applied. */
export async function computeEngagement(window: { startsAt: Date; endsAt: Date }, tx?: Tx, creatorId?: string): Promise<Map<string, EngagementScore>> {
  const exec = tx ?? db;
  const res = await exec.execute<{ creator_id: string; user_id: string; kind: "started" | "completed" | "repeat" }>(sql`
    select e.creator_id, e.user_id, e.kind
    from engagement_events e
    join challenges c on c.id = e.challenge_id
    join users u on u.id = e.user_id
    where e.created_at >= ${window.startsAt} and e.created_at < ${window.endsAt}
      and c.status in ('published', 'archived')
      and e.user_id <> e.creator_id
      ${creatorId ? sql`and e.creator_id = ${creatorId}` : sql``}
      and not (u.created_at >= ${new Date(window.endsAt.getTime() - 7 * 86_400_000)} and (select count(*) from attempts a where a.user_id = u.id) <= 1)`);
  const acc = new Map<string, { users: Set<string>; repeat: Set<string>; starts: number; completions: number }>();
  for (const r of res.rows) {
    const a = acc.get(r.creator_id) ?? { users: new Set(), repeat: new Set(), starts: 0, completions: 0 };
    a.users.add(r.user_id);
    if (r.kind === "completed") a.completions++;
    else {
      a.starts++;
      if (r.kind === "repeat") a.repeat.add(r.user_id);
    }
    acc.set(r.creator_id, a);
  }
  const out = new Map<string, EngagementScore>();
  for (const [id, a] of acc) {
    const completionRate = a.starts ? Math.min(1, a.completions / a.starts) : 0;
    const c = { creatorId: id, uniqueParticipants: a.users.size, starts: a.starts, completions: a.completions, repeatParticipants: a.repeat.size, completionRate };
    out.set(id, { ...c, score: Math.round(engagementScore(c) * 100) / 100 });
  }
  return out;
}

/** Tutor-facing summary for the current cycle. */
export async function tutorEngagementSummary(creatorId: string) {
  const cycle = await getCurrentCycle();
  const s = await getSettings(["tutor_reward.min_unique_participants", "tutor_reward.min_completion_rate_pct"]);
  const empty: EngagementScore = { creatorId, uniqueParticipants: 0, starts: 0, completions: 0, repeatParticipants: 0, completionRate: 0, score: 0 };
  const scores = cycle ? await computeEngagement(cycle, undefined, creatorId) : new Map();
  const me = scores.get(creatorId) ?? empty;
  const { plan } = await getActivePlan(creatorId);
  const eligible = me.uniqueParticipants >= s["tutor_reward.min_unique_participants"] && me.completionRate * 100 >= s["tutor_reward.min_completion_rate_pct"];
  return { cycle, score: me, eligible, minUnique: s["tutor_reward.min_unique_participants"], minCompletionPct: s["tutor_reward.min_completion_rate_pct"], planCode: plan.code as PlanCode };
}

async function distributeTutorRewards(cycle: Cycle, tx: Tx) {
  const s = await getSettings(["tutor_reward.min_unique_participants", "tutor_reward.min_completion_rate_pct"]);
  const scores = await computeEngagement(cycle, tx);
  const eligible = [...scores.values()]
    .filter((c) => c.uniqueParticipants >= s["tutor_reward.min_unique_participants"] && c.completionRate * 100 >= s["tutor_reward.min_completion_rate_pct"])
    .sort((a, b) => b.score - a.score || b.uniqueParticipants - a.uniqueParticipants || a.creatorId.localeCompare(b.creatorId));
  if (!eligible.length) return 0;
  const tutorIds = new Set((await tx.select({ id: tutorProfiles.userId }).from(tutorProfiles).where(inArray(tutorProfiles.userId, eligible.map((e) => e.creatorId)))).map((r) => r.id));
  const winners: Partial<Record<"free" | "premium", EngagementScore>> = {};
  for (const e of eligible) {
    if (!tutorIds.has(e.creatorId)) continue;
    const { plan } = await getActivePlan(e.creatorId, tx);
    if (plan.code === "premium_plus") continue; // recognition only
    if (!winners[plan.code]) winners[plan.code] = e;
    if (winners.free && winners.premium) break;
  }
  let n = 0;
  for (const fromPlan of ["free", "premium"] as const) {
    const w = winners[fromPlan];
    if (!w) continue;
    const grantedPlan = fromPlan === "free" ? "premium" : "premium_plus";
    const [row] = await tx
      .insert(tutorRewards)
      .values({ cycleId: cycle.id, tutorId: w.creatorId, fromPlan, grantedPlan, engagementScore: w.score.toFixed(2), status: "pending_review" })
      .onConflictDoNothing()
      .returning();
    if (!row) continue;
    n++;
    await notify(
      {
        userId: w.creatorId,
        type: "reward.tutor_engagement",
        title: `You are this cycle's top ${fromPlan === "free" ? "Free" : "Premium"} challenge creator`,
        body: `Your engagement score was ${w.score}. A month of ${grantedPlan === "premium" ? "Premium" : "Premium+"} is pending review by our team.`,
        href: "/tutor/challenges",
        dedupeKey: `notify:tutor_reward:${row.id}`,
      },
      tx,
    );
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Admin / finance actions (exported for the admin module)             */
/* ------------------------------------------------------------------ */

export async function approveStudentReward(adminId: string, id: string) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(studentRewards).where(eq(studentRewards.id, id)).for("update");
    if (!r) throw new DomainError("Reward not found.");
    if (r.status !== "pending_review") throw new DomainError(`Reward is already ${REWARD_STATUS_LABEL[r.status].toLowerCase()}.`);
    const cycle = await tx.query.leaderboardCycles.findFirst({ where: eq(leaderboardCycles.id, r.cycleId) });
    if (!cycle) throw new DomainError("Cycle not found.");
    if (r.kind === "credit") {
      await issueRewardCredit(tx, r, cycle, adminId);
    } else {
      await tx.update(studentRewards).set({ status: "approved", reviewedBy: adminId, updatedAt: new Date() }).where(eq(studentRewards.id, r.id));
    }
    await audit({ actorId: adminId, actorRole: "admin", action: "reward.approve", targetType: "student_reward", targetId: r.id, before: { status: r.status }, after: { status: r.kind === "credit" ? "credited" : "approved" } }, tx);
    return (await tx.query.studentRewards.findFirst({ where: eq(studentRewards.id, r.id) }))!;
  });
}

export async function rejectStudentReward(adminId: string, id: string, note: string) {
  if (!note?.trim()) throw new DomainError("Give a reason.");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(studentRewards).where(eq(studentRewards.id, id)).for("update");
    if (!r) throw new DomainError("Reward not found.");
    let status: typeof r.status;
    if (r.status === "pending_review" || r.status === "approved" || r.status === "failed") status = "rejected";
    else if (r.status === "credited" && r.creditEntryId) {
      await reverseCredit(tx, { entryId: r.creditEntryId, adminId, reason: `Leaderboard reward reversed: ${note.trim()}` });
      status = "reversed";
    } else throw new DomainError(`A ${REWARD_STATUS_LABEL[r.status].toLowerCase()} reward cannot be rejected.`);
    const [row] = await tx.update(studentRewards).set({ status, reviewedBy: adminId, reviewNote: note.trim(), updatedAt: new Date() }).where(eq(studentRewards.id, r.id)).returning();
    await audit({ actorId: adminId, actorRole: "admin", action: "reward.reject", targetType: "student_reward", targetId: r.id, before: { status: r.status }, after: { status, note } }, tx);
    await notify({ userId: r.userId, type: "reward.rejected", title: "Leaderboard reward update", body: `Your reward for rank #${r.rank} was not paid: ${note.trim()}`, href: "/dashboard/credits", dedupeKey: `notify:reward:${r.id}:rejected` }, tx);
    return row;
  });
}

/** Finance: cash reward paid out (reference from Flutterwave transfer or manual bank transfer). */
export async function markRewardPaid(adminId: string, id: string, payoutRef: string) {
  if (!payoutRef?.trim()) throw new DomainError("Enter the payout reference.");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(studentRewards).where(eq(studentRewards.id, id)).for("update");
    if (!r) throw new DomainError("Reward not found.");
    if (r.kind !== "cash") throw new DomainError("Only cash rewards can be marked paid.");
    if (r.status !== "approved" && r.status !== "payout_initiated") throw new DomainError("Approve the reward first.");
    const [row] = await tx.update(studentRewards).set({ status: "paid", reviewedBy: adminId, reviewNote: `Paid: ${payoutRef.trim()}`, updatedAt: new Date() }).where(eq(studentRewards.id, r.id)).returning();
    await audit({ actorId: adminId, actorRole: "admin", action: "reward.paid", targetType: "student_reward", targetId: r.id, after: { payoutRef } }, tx);
    await notify({ userId: r.userId, type: "reward.paid", title: "Your cash reward has been paid", body: `₦${Number(r.amountNgn).toLocaleString()} was sent to your bank account (ref ${payoutRef.trim()}).`, href: "/dashboard/credits", dedupeKey: `notify:reward:${r.id}:paid` }, tx);
    return row;
  });
}

export async function markRewardFailed(adminId: string, id: string, note: string) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(studentRewards).where(eq(studentRewards.id, id)).for("update");
    if (!r) throw new DomainError("Reward not found.");
    if (r.status !== "approved" && r.status !== "payout_initiated") throw new DomainError("Only approved cash rewards can fail.");
    const [row] = await tx.update(studentRewards).set({ status: "failed", reviewedBy: adminId, reviewNote: note?.trim() || "Payout failed", updatedAt: new Date() }).where(eq(studentRewards.id, r.id)).returning();
    await audit({ actorId: adminId, actorRole: "admin", action: "reward.failed", targetType: "student_reward", targetId: r.id, after: { note } }, tx);
    return row;
  });
}

export async function approveTutorReward(adminId: string, id: string) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(tutorRewards).where(eq(tutorRewards.id, id)).for("update");
    if (!r) throw new DomainError("Tutor reward not found.");
    if (r.status !== "pending_review") throw new DomainError(`Reward is already ${REWARD_STATUS_LABEL[r.status].toLowerCase()}.`);
    if (r.grantedPlan === "free") throw new DomainError("Nothing to grant.");
    const sub = await grantPromotionalMonth(tx, {
      tutorId: r.tutorId,
      planCode: r.grantedPlan,
      idempotencyKey: `tutor_reward:${r.id}`,
      reason: `Top ${r.fromPlan === "free" ? "Free" : "Premium"} challenge creator (engagement score ${r.engagementScore})`,
      actorId: null, // promotional source; the admin approval is audited below
    });
    const [row] = await tx.update(tutorRewards).set({ status: "credited", reviewedBy: adminId, subscriptionId: sub?.id ?? r.subscriptionId }).where(eq(tutorRewards.id, r.id)).returning();
    await audit({ actorId: adminId, actorRole: "admin", action: "tutor_reward.approve", targetType: "tutor_reward", targetId: r.id, after: { subscriptionId: sub?.id ?? null, grantedPlan: r.grantedPlan } }, tx);
    return row;
  });
}

export async function rejectTutorReward(adminId: string, id: string, note: string) {
  if (!note?.trim()) throw new DomainError("Give a reason.");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(tutorRewards).where(eq(tutorRewards.id, id)).for("update");
    if (!r) throw new DomainError("Tutor reward not found.");
    if (r.status !== "pending_review") throw new DomainError(`Reward is already ${REWARD_STATUS_LABEL[r.status].toLowerCase()}.`);
    const [row] = await tx.update(tutorRewards).set({ status: "rejected", reviewedBy: adminId, reviewNote: note.trim() }).where(eq(tutorRewards.id, r.id)).returning();
    await audit({ actorId: adminId, actorRole: "admin", action: "tutor_reward.reject", targetType: "tutor_reward", targetId: r.id, after: { note } }, tx);
    await notify({ userId: r.tutorId, type: "reward.tutor_rejected", title: "Engagement reward update", body: `Your plan reward was not granted: ${note.trim()}`, href: "/tutor/challenges", dedupeKey: `notify:tutor_reward:${r.id}:rejected` }, tx);
    return row;
  });
}

/* ------------------------------------------------------------------ */
/* Reads for pages                                                     */
/* ------------------------------------------------------------------ */

/** Reward outcomes for a cycle (names + kind + status; the amount is the public fixed value). */
export async function cycleRewardOutcomes(cycleId: string) {
  return db
    .select({
      id: studentRewards.id,
      userId: studentRewards.userId,
      rank: studentRewards.rank,
      kind: studentRewards.kind,
      status: studentRewards.status,
      displayName: sql<string>`coalesce(${users.displayName}, split_part(${users.fullName}, ' ', 1))`,
      city: cities.name,
    })
    .from(studentRewards)
    .innerJoin(users, eq(users.id, studentRewards.userId))
    .leftJoin(cities, eq(cities.id, users.cityId))
    .where(eq(studentRewards.cycleId, cycleId))
    .orderBy(asc(studentRewards.rank));
}

export async function userRewards(userId: string) {
  return db
    .select({
      id: studentRewards.id,
      rank: studentRewards.rank,
      kind: studentRewards.kind,
      amountNgn: studentRewards.amountNgn,
      status: studentRewards.status,
      eligibilityNote: studentRewards.eligibilityNote,
      reviewNote: studentRewards.reviewNote,
      createdAt: studentRewards.createdAt,
      cycleStartsAt: leaderboardCycles.startsAt,
      cycleEndsAt: leaderboardCycles.endsAt,
    })
    .from(studentRewards)
    .innerJoin(leaderboardCycles, eq(leaderboardCycles.id, studentRewards.cycleId))
    .where(eq(studentRewards.userId, userId))
    .orderBy(desc(studentRewards.createdAt))
    .limit(50);
}

export async function tutorRewardHistory(tutorId: string) {
  return db
    .select({ id: tutorRewards.id, fromPlan: tutorRewards.fromPlan, grantedPlan: tutorRewards.grantedPlan, engagementScore: tutorRewards.engagementScore, status: tutorRewards.status, reviewNote: tutorRewards.reviewNote, createdAt: tutorRewards.createdAt, cycleEndsAt: leaderboardCycles.endsAt })
    .from(tutorRewards)
    .innerJoin(leaderboardCycles, eq(leaderboardCycles.id, tutorRewards.cycleId))
    .where(eq(tutorRewards.tutorId, tutorId))
    .orderBy(desc(tutorRewards.createdAt))
    .limit(20);
}
