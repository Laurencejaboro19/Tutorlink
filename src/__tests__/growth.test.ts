import { and, count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { attempts, bookings, creditEntries, engagementEvents, leaderboardCycles, leaderboardResults, packages, referralEvents, referrals, studentRewards, subjects, subscriptions, tutorProfiles, tutorRewards } from "@/db/schema";
import { DomainError } from "@/lib/result";
import { addDays, platformDay } from "@/lib/time";
import { createChallenge, getAttemptQuestions, reviewChallenge, startAttempt, submitAttempt, submitForReview, type ChallengeInput } from "@/server/challenges";
import { creditBalance, issueCredit, redeemCredit, reverseCredit } from "@/server/credits";
import { approveTutorReward, distributeRewards, ensureOpenCycle, finalizeCycle, liveStandings } from "@/server/leaderboards";
import { onOnboardingComplete, onSessionCompleted } from "@/server/referrals";
import { createUser, truncateAll } from "./setup";

/* ---------------- helpers ---------------- */

function q(points: number, correctKey = "A", n = 4) {
  return {
    prompt: `Question worth ${points}`,
    options: ["A", "B", "C", "D", "E", "F"].slice(0, n).map((k) => ({ key: k, text: `Option ${k}` })),
    correctKey,
    explanation: `Because ${correctKey}`,
    points,
  };
}

function input(over: Partial<ChallengeInput> = {}): ChallengeInput {
  return {
    title: "Daily maths",
    category: "Mathematics",
    scheduledFor: platformDay(),
    timeLimitSeconds: 600,
    maxAttempts: 1,
    questions: [q(10, "A"), q(20, "B"), q(5, "C")],
    ...over,
  };
}

/** Admin-created challenges publish directly on submit. */
async function publishedChallenge(over: Partial<ChallengeInput> = {}) {
  const admin = await createUser({ adminRole: "super", isTutor: true });
  const c = await createChallenge(admin.id, input(over));
  const pub = await submitForReview(admin.id, c.id);
  expect(pub.status).toBe("published");
  return { admin, challenge: pub };
}

/** Make a submitted attempt look like it took `seconds` and finished at `at`. */
async function shape(attemptId: string, patch: { seconds?: number; at?: Date }) {
  const a = await db.query.attempts.findFirst({ where: eq(attempts.id, attemptId) });
  if (!a) throw new Error("attempt missing");
  const at = patch.at ?? a.submittedAt ?? new Date();
  const seconds = patch.seconds ?? a.durationSeconds ?? 10;
  await db.update(attempts).set({ submittedAt: at, startedAt: new Date(at.getTime() - seconds * 1000), durationSeconds: seconds }).where(eq(attempts.id, attemptId));
}

async function play(userId: string, challengeId: string, answers: Record<number, string>, seconds = 10) {
  const { attempt, questions } = await startAttempt(userId, challengeId);
  const byPos = Object.fromEntries(questions.map((qq) => [qq.position, qq.id]));
  const ans: Record<string, string> = {};
  for (const [pos, key] of Object.entries(answers)) ans[byPos[Number(pos)]] = key;
  const res = await submitAttempt(userId, attempt.id, ans);
  await shape(attempt.id, { seconds });
  return res;
}

async function endedCycle() {
  const [cycle] = await db
    .insert(leaderboardCycles)
    .values({ startsAt: addDays(new Date(), -31), endsAt: addDays(new Date(), -1), durationDays: 30, budgetNgn: "50000.00", status: "open" })
    .returning();
  return cycle;
}

beforeEach(async () => {
  await truncateAll();
});

/* ---------------- challenges ---------------- */

describe("challenge authoring", () => {
  it("validates questions server-side", async () => {
    const tutor = await createUser({ isTutor: true });
    await expect(createChallenge(tutor.id, input({ questions: [] }))).rejects.toThrow(DomainError);
    await expect(createChallenge(tutor.id, input({ questions: [{ ...q(10), options: [{ key: "A", text: "only" }] }] }))).rejects.toThrow(/between 2 and 6/);
    await expect(createChallenge(tutor.id, input({ questions: [q(10, "Z")] }))).rejects.toThrow(/exactly one correct/);
    await expect(createChallenge(tutor.id, input({ questions: [q(99)] }))).rejects.toThrow(/points/);
    await expect(createChallenge(tutor.id, input({ questions: [{ ...q(10), options: [{ key: "B", text: "x" }, { key: "A", text: "y" }] }] }))).rejects.toThrow(/labelled/);
    const ok = await createChallenge(tutor.id, input());
    expect(ok.status).toBe("draft");
    const inReview = await submitForReview(tutor.id, ok.id);
    expect(inReview.status).toBe("in_review");
  });

  it("prevents duplicate published challenges per creator/category/day", async () => {
    const { admin } = await publishedChallenge();
    const second = await createChallenge(admin.id, input({ title: "Another" }));
    await expect(submitForReview(admin.id, second.id)).rejects.toThrow(/already has a published challenge/);
  });
});

describe("attempts & grading", () => {
  it("never exposes correctKey or explanation before submission, grades server-side and reveals after", async () => {
    const { challenge } = await publishedChallenge();
    const student = await createUser({ isStudent: true });
    const { attempt, questions } = await startAttempt(student.id, challenge.id);
    expect(attempt.status).toBe("in_progress");
    expect(attempt.attemptNo).toBe(1);
    for (const qq of questions) {
      expect(qq).not.toHaveProperty("correctKey");
      expect(qq).not.toHaveProperty("explanation");
      expect(JSON.stringify(qq)).not.toMatch(/correct/i);
    }
    const again = await getAttemptQuestions(attempt.id, student.id);
    expect(Object.keys(again.questions[0]).sort()).toEqual(["id", "options", "points", "position", "prompt"]);

    const byPos = Object.fromEntries(questions.map((qq) => [qq.position, qq.id]));
    // Q1 correct (A, 10), Q2 wrong (A instead of B, 20), Q3 correct (C, 5), plus junk ignored
    const res = await submitAttempt(student.id, attempt.id, { [byPos[1]]: "A", [byPos[2]]: "A", [byPos[3]]: "C", "not-a-question": "A" });
    expect(res.attempt.status).toBe("submitted");
    expect(res.attempt.score).toBe(15);
    expect(res.attempt.maxScore).toBe(35);
    expect(res.attempt.correctCount).toBe(2);
    expect(res.questions.map((x) => x.correct)).toEqual([true, false, true]);
    expect(res.questions[1].correctKey).toBe("B");
    expect(res.questions[1].explanation).toBe("Because B");
    expect(res.attempt.answers).not.toHaveProperty("not-a-question");
  });

  it("rejects a double submit", async () => {
    const { challenge } = await publishedChallenge();
    const student = await createUser({ isStudent: true });
    const { attempt } = await startAttempt(student.id, challenge.id);
    await submitAttempt(student.id, attempt.id, {});
    await expect(submitAttempt(student.id, attempt.id, {})).rejects.toThrow(/already been submitted/);
  });

  it("enforces maxAttempts and records repeat engagement", async () => {
    const { challenge } = await publishedChallenge({ maxAttempts: 2 });
    const student = await createUser({ isStudent: true });
    const a1 = await startAttempt(student.id, challenge.id);
    await submitAttempt(student.id, a1.attempt.id, {});
    const a2 = await startAttempt(student.id, challenge.id);
    expect(a2.attempt.attemptNo).toBe(2);
    await submitAttempt(student.id, a2.attempt.id, {});
    await expect(startAttempt(student.id, challenge.id)).rejects.toThrow(/all 2 attempts/);
    const kinds = await db.query.engagementEvents.findMany({ where: eq(engagementEvents.userId, student.id) });
    expect(kinds.map((k) => k.kind).sort()).toEqual(["completed", "completed", "repeat", "started"]);
  });

  it("resumes an in-progress attempt instead of creating a second one", async () => {
    const { challenge } = await publishedChallenge();
    const student = await createUser({ isStudent: true });
    const a1 = await startAttempt(student.id, challenge.id);
    const a2 = await startAttempt(student.id, challenge.id);
    expect(a2.resumed).toBe(true);
    expect(a2.attempt.id).toBe(a1.attempt.id);
  });

  it("creators cannot attempt their own challenge", async () => {
    const { admin, challenge } = await publishedChallenge();
    await expect(startAttempt(admin.id, challenge.id)).rejects.toThrow(/own challenge/);
  });

  it("marks a submit after the deadline as expired (still graded) and flags fast attempts", async () => {
    const { challenge } = await publishedChallenge();
    const student = await createUser({ isStudent: true });
    const { attempt, questions } = await startAttempt(student.id, challenge.id);
    await db.update(attempts).set({ deadlineAt: new Date(Date.now() - 60_000) }).where(eq(attempts.id, attempt.id));
    const res = await submitAttempt(student.id, attempt.id, { [questions[0].id]: "A" });
    expect(res.attempt.status).toBe("expired");
    expect(res.attempt.score).toBe(10);
    expect(res.suspicious).toBe(true); // finished in < 5 s
    const events = await db.query.engagementEvents.findMany({ where: eq(engagementEvents.userId, student.id) });
    expect(events.map((e) => e.kind)).toEqual(["started"]); // no 'completed' for expired
  });
});

/* ---------------- leaderboards ---------------- */

describe("leaderboards", () => {
  it("orders by points, then correct, then shorter duration, then first submission", async () => {
    const cycle = await ensureOpenCycle();
    const maths = (await db.query.subjects.findFirst({ where: eq(subjects.name, "Mathematics") }))!;
    const { challenge: c1 } = await publishedChallenge({ category: "Maths", subjectId: maths.id });
    const { challenge: c2 } = await publishedChallenge({ category: "Physics", questions: [q(15, "A"), q(15, "B")] });
    const u1 = await createUser({ isStudent: true });
    const u2 = await createUser({ isStudent: true });
    const u3 = await createUser({ isStudent: true });
    const u4 = await createUser({ isStudent: true });
    // All three get 30 points: u1 via 2 correct on c1 (10+20); u2 via 3 correct (10+5 on c1, 15 on c2); u3 like u1 but slower.
    await play(u1.id, c1.id, { 1: "A", 2: "B" }, 20);
    await play(u2.id, c1.id, { 1: "A", 3: "C" }, 10);
    await play(u2.id, c2.id, { 1: "A" }, 10);
    await play(u3.id, c1.id, { 1: "A", 2: "B" }, 40);
    // u4: higher raw score but suspiciously fast → ignored entirely
    await play(u4.id, c1.id, { 1: "A", 2: "B", 3: "C" }, 2);
    const { rows } = await liveStandings({ scope: "nationwide", cycleId: cycle.id });
    expect(rows.map((r) => r.userId)).toEqual([u2.id, u1.id, u3.id]);
    expect(rows.map((r) => r.points)).toEqual([30, 30, 30]);
    expect(rows[0].correctCount).toBe(3);
    expect(rows[0].attemptsCount).toBe(2);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    // subject scope counts only c1: u1 30 (20 s), u3 30 (40 s), u2 15
    const subj = await liveStandings({ scope: "subject", scopeKey: String(maths.id), cycleId: cycle.id });
    expect(subj.rows.map((r) => [r.userId, r.points])).toEqual([
      [u1.id, 30],
      [u3.id, 30],
      [u2.id, 15],
    ]);
  });

  it("finalizeCycle is idempotent", async () => {
    const cycle = await endedCycle();
    const { challenge } = await publishedChallenge();
    const u1 = await createUser({ isStudent: true });
    const u2 = await createUser({ isStudent: true });
    const r1 = await play(u1.id, challenge.id, { 1: "A" });
    const r2 = await play(u2.id, challenge.id, { 1: "A", 2: "B" });
    const inside = addDays(new Date(), -5);
    await shape(r1.attempt.id, { at: inside });
    await shape(r2.attempt.id, { at: inside });
    const first = await finalizeCycle(cycle.id);
    expect(first.inserted).toBe(2); // nationwide only (users have no state/city; challenge has no subject)
    const second = await finalizeCycle(cycle.id);
    expect(second.alreadyFinalized).toBe(true);
    const [{ n }] = await db.select({ n: count() }).from(leaderboardResults).where(eq(leaderboardResults.cycleId, cycle.id));
    expect(n).toBe(2);
    const top = await db.query.leaderboardResults.findFirst({ where: and(eq(leaderboardResults.cycleId, cycle.id), eq(leaderboardResults.rank, 1)) });
    expect(top?.userId).toBe(u2.id);
  });

  it("distributes top-N rewards as cash or credit, once, within budget", async () => {
    const cycle = await endedCycle();
    await db.update(leaderboardCycles).set({ budgetNgn: "10000.00" }).where(eq(leaderboardCycles.id, cycle.id)); // room for 2 × ₦5,000
    const students = [] as { id: string }[];
    const inside = addDays(new Date(), -5);
    // 5 challenges so everyone can reach the 5-attempt eligibility threshold
    const cs = [] as string[];
    for (let i = 0; i < 5; i++) cs.push((await publishedChallenge({ category: `Cat${i}` })).challenge.id);
    for (let i = 0; i < 4; i++) students.push(await createUser({ isStudent: true }));
    const ineligible = await createUser({ isStudent: true });
    for (const [i, s] of students.entries()) {
      for (const c of cs) {
        // student 0 best, then 1, 2, 3
        const r = await play(s.id, c, i === 0 ? { 1: "A", 2: "B", 3: "C" } : i === 1 ? { 1: "A", 2: "B" } : i === 2 ? { 1: "A" } : {});
        await shape(r.attempt.id, { at: inside });
      }
    }
    const r = await play(ineligible.id, cs[0], { 1: "A", 2: "B", 3: "C" }); // 1 attempt only → ineligible
    await shape(r.attempt.id, { at: inside });

    // student 1 completed a paid ₦8,000 session inside the cycle → cash
    const tutor = await createUser({ isTutor: true });
    await db.insert(tutorProfiles).values({ userId: tutor.id });
    const subj = (await db.query.subjects.findFirst())!;
    const [pkg] = await db.insert(packages).values({ tutorId: tutor.id, title: "P", description: "d", subjectId: subj.id, level: "senior_secondary", format: "online", priceNgn: "8000.00", durationMinutes: 60, status: "published" }).returning();
    await db.insert(bookings).values({
      studentId: students[1].id,
      tutorId: tutor.id,
      packageId: pkg.id,
      format: "online",
      startsAt: addDays(new Date(), -6),
      endsAt: new Date(addDays(new Date(), -6).getTime() + 3_600_000),
      status: "completed",
      priceNgn: "8000.00",
      amountDueNgn: "8000.00",
      planCodeAtBooking: "free",
      commissionPct: "30.00",
      commissionNgn: "2400.00",
      tutorEarningNgn: "5600.00",
      paymentId: crypto.randomUUID(),
      completedAt: inside,
    });

    await finalizeCycle(cycle.id);
    const out = await distributeRewards(cycle.id);
    expect(out.cash).toBe(1);
    expect(out.credit).toBe(1);
    expect(out.rejected).toBe(2); // budget exhausted for ranks 3 and 4
    const rewards = await db.select().from(studentRewards).where(eq(studentRewards.cycleId, cycle.id)).orderBy(studentRewards.rank);
    expect(rewards.map((x) => [x.rank, x.kind, x.status])).toEqual([
      [1, "credit", "credited"],
      [2, "cash", "pending_review"],
      [3, "credit", "rejected"],
      [5, "credit", "rejected"], // rank 4 is the ineligible single-attempt user
    ]);
    expect(rewards.find((x) => x.userId === ineligible.id)).toBeUndefined();
    expect(await creditBalance(students[0].id)).toBe("5000.00");
    expect(await creditBalance(students[1].id)).toBe("0.00");

    // rerun: nothing doubles
    const again = await distributeRewards(cycle.id);
    expect(again.alreadyRewarded).toBe(true);
    expect(await creditBalance(students[0].id)).toBe("5000.00");
    const [{ n }] = await db.select({ n: count() }).from(creditEntries);
    expect(n).toBe(1);
  });
  it("awards the top Free-plan creator a pending Premium month; approval grants it once", async () => {
    const cycle = await endedCycle();
    const inside = addDays(new Date(), -5);
    const admin = await createUser({ adminRole: "moderator" });
    const tutor = await createUser({ isTutor: true });
    await db.insert(tutorProfiles).values({ userId: tutor.id });
    const ids: string[] = [];
    for (const cat of ["Maths", "Physics"]) {
      const c = await createChallenge(tutor.id, input({ category: cat }));
      expect((await submitForReview(tutor.id, c.id)).status).toBe("in_review");
      expect((await reviewChallenge(admin.id, c.id, "approve")).status).toBe("published");
      ids.push(c.id);
    }
    // 10 unique participants, each completing both challenges (≥ 2 attempts so the new-account heuristic keeps them)
    for (let i = 0; i < 10; i++) {
      const s = await createUser({ isStudent: true });
      for (const id of ids) {
        const r = await play(s.id, id, { 1: "A" });
        await shape(r.attempt.id, { at: inside });
      }
    }
    await db.update(engagementEvents).set({ createdAt: inside });
    await finalizeCycle(cycle.id);
    const out = await distributeRewards(cycle.id);
    expect(out.tutorRewards).toBe(1);
    const [reward] = await db.select().from(tutorRewards).where(eq(tutorRewards.cycleId, cycle.id));
    expect(reward.tutorId).toBe(tutor.id);
    expect([reward.fromPlan, reward.grantedPlan, reward.status]).toEqual(["free", "premium", "pending_review"]);
    expect(Number(reward.engagementScore)).toBe(10 + 2 * 20 + 10 * 1); // 10 unique + 2×20 completions + 0 repeat + 10×100%
    const approved = await approveTutorReward(admin.id, reward.id);
    expect(approved.status).toBe("credited");
    const subs = await db.select().from(subscriptions).where(eq(subscriptions.tutorId, tutor.id));
    expect(subs.map((x) => [x.planCode, x.source, x.status])).toEqual([["premium", "promotional", "active"]]);
    await expect(approveTutorReward(admin.id, reward.id)).rejects.toThrow(/already/);
  });
});

/* ---------------- referrals ---------------- */

describe("referrals", () => {
  it("awards student_verified exactly once", async () => {
    const referrer = await createUser({ isStudent: true });
    const referred = await createUser({ isStudent: true });
    await db.insert(referrals).values({ referrerId: referrer.id, referredUserId: referred.id, kind: "student" });
    await onOnboardingComplete(referred.id, { isStudent: true, isTutor: false });
    await onOnboardingComplete(referred.id, { isStudent: true, isTutor: false });
    expect(await creditBalance(referrer.id)).toBe("500.00");
    const [{ n }] = await db.select({ n: count() }).from(referralEvents);
    expect(n).toBe(1);
  });

  it("flagged (self/duplicate) referrals never earn credit", async () => {
    const referrer = await createUser({ isStudent: true });
    const referred = await createUser({ isStudent: true });
    await db.insert(referrals).values({ referrerId: referrer.id, referredUserId: referred.id, kind: "student", flagged: true, flagReason: "same ip as referrer" });
    await onOnboardingComplete(referred.id, { isStudent: true, isTutor: false });
    expect(await creditBalance(referrer.id)).toBe("0.00");
    const [{ n }] = await db.select({ n: count() }).from(referralEvents);
    expect(n).toBe(0);
  });

  it("awards tutor_five_sessions after five completed paid bookings", async () => {
    const referrer = await createUser({ isTutor: true });
    const tutor = await createUser({ isTutor: true });
    await db.insert(tutorProfiles).values({ userId: tutor.id });
    await db.insert(referrals).values({ referrerId: referrer.id, referredUserId: tutor.id, kind: "tutor" });
    const student = await createUser({ isStudent: true });
    const subj = (await db.query.subjects.findFirst())!;
    const [pkg] = await db.insert(packages).values({ tutorId: tutor.id, title: "P", description: "d", subjectId: subj.id, level: "primary", format: "online", priceNgn: "5000.00", durationMinutes: 60, status: "published" }).returning();
    const rows = [] as (typeof bookings.$inferSelect)[];
    const insertBooking = async (i: number) => {
      const startsAt = addDays(new Date(), -10 + i);
      const [b] = await db
        .insert(bookings)
        .values({ studentId: student.id, tutorId: tutor.id, packageId: pkg.id, format: "online", startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), status: "completed", priceNgn: "5000.00", amountDueNgn: "5000.00", planCodeAtBooking: "free", commissionPct: "30.00", commissionNgn: "1500.00", tutorEarningNgn: "3500.00", paymentId: crypto.randomUUID(), completedAt: startsAt })
        .returning();
      rows.push(b);
      return b;
    };
    for (let i = 0; i < 4; i++) await insertBooking(i);
    await db.transaction((tx) => onSessionCompleted(tx, rows[3]));
    expect(await creditBalance(referrer.id)).toBe("0.00"); // only four completed sessions so far
    const fifth = await insertBooking(4);
    await db.transaction((tx) => onSessionCompleted(tx, fifth));
    await db.transaction((tx) => onSessionCompleted(tx, fifth)); // replay → no double credit
    expect(await creditBalance(referrer.id)).toBe("2000.00");
  });
});

/* ---------------- credits ---------------- */

describe("credits", () => {
  it("cannot redeem beyond the balance and can reverse a credit", async () => {
    const admin = await createUser({ adminRole: "finance" });
    const u = await createUser({ isStudent: true });
    const entry = await issueCredit({ userId: u.id, amountNgn: "1000.00", type: "promotional", source: "test", reason: "seed", idempotencyKey: "t:1" });
    expect(entry).toBeTruthy();
    await expect(db.transaction((tx) => redeemCredit(tx, { userId: u.id, amountNgn: "1500.00", bookingId: crypto.randomUUID(), idempotencyKey: "r:1" }))).rejects.toThrow(/Insufficient/);
    await db.transaction((tx) => redeemCredit(tx, { userId: u.id, amountNgn: "400.00", bookingId: crypto.randomUUID(), idempotencyKey: "r:2" }));
    expect(await creditBalance(u.id)).toBe("600.00");
    await db.transaction((tx) => reverseCredit(tx, { entryId: entry!.id, adminId: admin.id, reason: "fraud" }));
    expect(await creditBalance(u.id)).toBe("-400.00");
    const [{ n }] = await db.select({ n: count() }).from(creditEntries).where(eq(creditEntries.status, "reversed"));
    expect(n).toBe(2); // the original entry and its audit-only reversal row; neither counts in the balance
  });
});
