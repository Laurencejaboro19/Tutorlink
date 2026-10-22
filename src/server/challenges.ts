import "server-only";
import { and, asc, count, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { attempts, challenges, engagementEvents, exams, questions, subjects, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { rateLimit } from "@/lib/rate-limit";
import { DomainError } from "@/lib/result";
import { getSetting } from "@/lib/settings";
import { addDays, platformDay, platformDayStart } from "@/lib/time";

/**
 * Daily challenge engine.
 *
 * Lifecycle: draft ─(submit)─▶ in_review ─(admin approve)─▶ published ─▶ archived
 *                              └(admin reject)─▶ rejected ─(edit)─▶ draft
 * Admin-created challenges may publish directly. Tutor challenges need review unless
 * `challenge.require_review_for_tutor_challenges` is false.
 *
 * Attempt window: a challenge is attemptable during its `scheduledFor` platform day
 * (Africa/Lagos, 00:00:00–23:59:59). Each attempt's deadline is
 * min(startedAt + timeLimitSeconds, end of that day). Grading only ever happens here —
 * `correctKey` and `explanation` are revealed only in the result of a finished attempt.
 *
 * Anti-abuse: 30 attempt starts / hour / user, a per-user daily attempt cap, creators cannot
 * attempt their own challenges, and attempts finished in under 5 seconds are flagged
 * `suspicious` and ignored by leaderboards.
 */

export const OPTION_KEYS = ["A", "B", "C", "D", "E", "F"] as const;
export const MIN_VALID_DURATION_SECONDS = 5;
/** Network latency allowance when the client submits right at the deadline. */
const SUBMIT_GRACE_MS = 3_000;

export type QuestionInput = {
  prompt: string;
  options: { key: string; text: string }[];
  correctKey: string;
  explanation?: string | null;
  points: number;
};

export type ChallengeInput = {
  title: string;
  description?: string | null;
  category: string;
  subjectId?: number | null;
  level?: "primary" | "junior_secondary" | "senior_secondary" | "tertiary" | "adult" | null;
  examId?: number | null;
  scheduledFor: string; // YYYY-MM-DD platform day
  timeLimitSeconds: number;
  maxAttempts: number;
  questions: QuestionInput[];
};

export type Challenge = typeof challenges.$inferSelect;
export type Attempt = typeof attempts.$inferSelect;
/** A question as the client may see it before submission: no correctKey, no explanation. */
export type SafeQuestion = { id: string; position: number; prompt: string; options: { key: string; text: string }[]; points: number };

export const CHALLENGE_STATUS_LABEL: Record<Challenge["status"], string> = {
  draft: "Draft",
  in_review: "In review",
  published: "Published",
  rejected: "Rejected",
  archived: "Archived",
};

export const ATTEMPT_STATUS_LABEL: Record<Attempt["status"], string> = {
  in_progress: "In progress",
  submitted: "Submitted",
  expired: "Expired",
};

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

/** Attempt window for a platform day: [start, end] where end = 23:59:59 Lagos. */
export function challengeWindow(day: string) {
  const start = platformDayStart(day);
  const end = new Date(addDays(start, 1).getTime() - 1_000);
  return { start, end };
}

export function isWindowOpen(day: string, now = new Date()) {
  const w = challengeWindow(day);
  return now >= w.start && now <= w.end;
}

/* ------------------------------------------------------------------ */
/* Validation (defensive — the actions file also validates with zod)   */
/* ------------------------------------------------------------------ */

export function validateQuestions(qs: QuestionInput[]) {
  if (!qs.length) throw new DomainError("Add at least one question.");
  if (qs.length > 50) throw new DomainError("A challenge can have at most 50 questions.");
  qs.forEach((q, i) => {
    const n = i + 1;
    if (!q.prompt?.trim()) throw new DomainError(`Question ${n}: enter the question text.`);
    if (q.options.length < 2 || q.options.length > 6) throw new DomainError(`Question ${n}: use between 2 and 6 options.`);
    const expected = OPTION_KEYS.slice(0, q.options.length);
    q.options.forEach((o, j) => {
      if (o.key !== expected[j]) throw new DomainError(`Question ${n}: options must be labelled ${expected.join(", ")} in order.`);
      if (!o.text?.trim()) throw new DomainError(`Question ${n}: option ${o.key} is empty.`);
    });
    if (!expected.includes(q.correctKey as (typeof OPTION_KEYS)[number])) throw new DomainError(`Question ${n}: mark exactly one correct option.`);
    if (!Number.isInteger(q.points) || q.points < 1 || q.points > 50) throw new DomainError(`Question ${n}: points must be between 1 and 50.`);
  });
}

function validateChallengeInput(input: ChallengeInput) {
  if (!input.title?.trim()) throw new DomainError("Enter a title.");
  if (!input.category?.trim()) throw new DomainError("Choose a category.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledFor) || Number.isNaN(platformDayStart(input.scheduledFor).getTime())) throw new DomainError("Choose a valid date.");
  if (input.timeLimitSeconds < 30 || input.timeLimitSeconds > 86_400) throw new DomainError("Time limit must be between 30 seconds and 24 hours.");
  if (input.maxAttempts < 1 || input.maxAttempts > 10) throw new DomainError("Max attempts must be between 1 and 10.");
  validateQuestions(input.questions);
}

function questionRows(challengeId: string, qs: QuestionInput[]) {
  return qs.map((q, i) => ({
    challengeId,
    position: i + 1,
    type: "multiple_choice",
    prompt: q.prompt.trim(),
    options: q.options.map((o) => ({ key: o.key, text: o.text.trim() })),
    correctKey: q.correctKey,
    explanation: q.explanation?.trim() || null,
    points: q.points,
  }));
}

/* ------------------------------------------------------------------ */
/* Authoring                                                           */
/* ------------------------------------------------------------------ */

export async function createChallenge(creatorId: string, input: ChallengeInput) {
  validateChallengeInput(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(challenges)
      .values({
        creatorId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        category: input.category.trim(),
        subjectId: input.subjectId ?? null,
        level: input.level ?? null,
        examId: input.examId ?? null,
        scheduledFor: input.scheduledFor,
        timeLimitSeconds: input.timeLimitSeconds,
        maxAttempts: input.maxAttempts,
        status: "draft",
      })
      .returning();
    await tx.insert(questions).values(questionRows(row.id, input.questions));
    await audit({ actorId: creatorId, action: "challenge.create", targetType: "challenge", targetId: row.id, after: { title: row.title, scheduledFor: row.scheduledFor } }, tx);
    return row;
  });
}

/** Drafts and rejected challenges are editable; editing a rejected one returns it to draft. */
export async function updateChallenge(creatorId: string, id: string, input: ChallengeInput) {
  validateChallengeInput(input);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(challenges).where(eq(challenges.id, id)).for("update");
    if (!c || c.creatorId !== creatorId) throw new DomainError("Challenge not found.");
    if (c.status !== "draft" && c.status !== "rejected") throw new DomainError(`A ${CHALLENGE_STATUS_LABEL[c.status].toLowerCase()} challenge cannot be edited.`);
    const [row] = await tx
      .update(challenges)
      .set({
        title: input.title.trim(),
        description: input.description?.trim() || null,
        category: input.category.trim(),
        subjectId: input.subjectId ?? null,
        level: input.level ?? null,
        examId: input.examId ?? null,
        scheduledFor: input.scheduledFor,
        timeLimitSeconds: input.timeLimitSeconds,
        maxAttempts: input.maxAttempts,
        status: "draft",
        reviewNote: null,
        reviewedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(challenges.id, c.id))
      .returning();
    await tx.delete(questions).where(eq(questions.challengeId, c.id));
    await tx.insert(questions).values(questionRows(c.id, input.questions));
    await audit({ actorId: creatorId, action: "challenge.update", targetType: "challenge", targetId: c.id, before: { status: c.status }, after: { status: "draft" } }, tx);
    return row;
  });
}

async function publishRow(tx: Tx, c: Challenge, actorId: string, note?: string | null) {
  try {
    const [row] = await tx
      .update(challenges)
      .set({ status: "published", publishedAt: new Date(), reviewedBy: actorId, reviewNote: note ?? null, updatedAt: new Date() })
      .where(eq(challenges.id, c.id))
      .returning();
    return row;
  } catch (e) {
    // challenges_daily_uq: one published challenge per creator per category per day
    const cause = e && typeof e === "object" && "cause" in e ? (e as { cause: unknown }).cause : e;
    if (cause && typeof cause === "object" && "code" in cause && (cause as { code: string }).code === "23505") {
      throw new DomainError("This creator already has a published challenge in that category on that day.");
    }
    throw e;
  }
}

/** Tutor submits for review. Admin creators (or when review is disabled) publish directly. */
export async function submitForReview(creatorId: string, id: string) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(challenges).where(eq(challenges.id, id)).for("update");
    if (!c || c.creatorId !== creatorId) throw new DomainError("Challenge not found.");
    if (c.status !== "draft" && c.status !== "rejected") throw new DomainError("Only drafts can be submitted.");
    const [{ n }] = await tx.select({ n: count() }).from(questions).where(eq(questions.challengeId, c.id));
    if (n === 0) throw new DomainError("Add at least one question before submitting.");
    if (challengeWindow(c.scheduledFor).end < new Date()) throw new DomainError("The scheduled day has already passed. Pick a future day.");
    const creator = await tx.query.users.findFirst({ where: eq(users.id, creatorId), columns: { adminRole: true } });
    const requireReview = await getSetting("challenge.require_review_for_tutor_challenges");
    if (creator?.adminRole || !requireReview) {
      const row = await publishRow(tx, c, creatorId, null);
      await audit({ actorId: creatorId, action: "challenge.publish", targetType: "challenge", targetId: c.id, before: { status: c.status }, after: { status: "published" } }, tx);
      return row;
    }
    const [row] = await tx.update(challenges).set({ status: "in_review", reviewNote: null, updatedAt: new Date() }).where(eq(challenges.id, c.id)).returning();
    await audit({ actorId: creatorId, action: "challenge.submit_for_review", targetType: "challenge", targetId: c.id, before: { status: c.status }, after: { status: "in_review" } }, tx);
    return row;
  });
}

/** Admin review. Exported for the admin module. */
export async function reviewChallenge(adminId: string, id: string, decision: "approve" | "reject", note?: string | null) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(challenges).where(eq(challenges.id, id)).for("update");
    if (!c) throw new DomainError("Challenge not found.");
    if (c.status !== "in_review") throw new DomainError("Only challenges in review can be approved or rejected.");
    let row: Challenge;
    if (decision === "approve") {
      row = await publishRow(tx, c, adminId, note);
    } else {
      if (!note?.trim()) throw new DomainError("Give the creator a reason for the rejection.");
      [row] = await tx.update(challenges).set({ status: "rejected", reviewedBy: adminId, reviewNote: note.trim(), updatedAt: new Date() }).where(eq(challenges.id, c.id)).returning();
    }
    await audit({ actorId: adminId, actorRole: "admin", action: `challenge.${decision}`, targetType: "challenge", targetId: c.id, before: { status: c.status }, after: { status: row.status, note } }, tx);
    await notify(
      {
        userId: c.creatorId,
        type: "challenge.reviewed",
        title: decision === "approve" ? "Your challenge was approved" : "Your challenge needs changes",
        body: decision === "approve" ? `“${c.title}” is published for ${c.scheduledFor}.` : `“${c.title}” was not approved: ${note}`,
        href: `/tutor/challenges/${c.id}/edit`,
        dedupeKey: `notify:challenge:${c.id}:${decision}:${Date.now()}`,
      },
      tx,
    );
    return row;
  });
}

/** Creator (or admin) archives a challenge in any state. Past attempts are kept. */
export async function archiveChallenge(actorId: string, id: string, opts: { admin?: boolean } = {}) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(challenges).where(eq(challenges.id, id)).for("update");
    if (!c || (!opts.admin && c.creatorId !== actorId)) throw new DomainError("Challenge not found.");
    if (c.status === "archived") return c;
    const [row] = await tx.update(challenges).set({ status: "archived", updatedAt: new Date() }).where(eq(challenges.id, c.id)).returning();
    await audit({ actorId, action: "challenge.archive", targetType: "challenge", targetId: c.id, before: { status: c.status }, after: { status: "archived" } }, tx);
    return row;
  });
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

const creatorName = sql<string>`coalesce(${users.displayName}, split_part(${users.fullName}, ' ', 1))`;

export type ChallengeCard = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  level: Challenge["level"];
  subjectId: number | null;
  subjectName: string | null;
  examName: string | null;
  scheduledFor: string;
  timeLimitSeconds: number;
  maxAttempts: number;
  creatorId: string;
  creatorName: string;
  questionCount: number;
  totalPoints: number;
};

const cardSelect = {
  id: challenges.id,
  title: challenges.title,
  description: challenges.description,
  category: challenges.category,
  level: challenges.level,
  subjectId: challenges.subjectId,
  subjectName: subjects.name,
  examName: exams.name,
  scheduledFor: challenges.scheduledFor,
  timeLimitSeconds: challenges.timeLimitSeconds,
  maxAttempts: challenges.maxAttempts,
  creatorId: challenges.creatorId,
  creatorName,
  questionCount: sql<number>`(select count(*)::int from ${questions} q where q.challenge_id = ${challenges.id})`,
  totalPoints: sql<number>`(select coalesce(sum(q.points), 0)::int from ${questions} q where q.challenge_id = ${challenges.id})`,
};

/** Published challenges for a platform day (YYYY-MM-DD) with optional filters. */
export async function listPublishedForDay(day: string, filters: { category?: string; level?: string; subjectId?: number } = {}): Promise<ChallengeCard[]> {
  const where = [eq(challenges.scheduledFor, day), eq(challenges.status, "published")];
  if (filters.category) where.push(eq(challenges.category, filters.category));
  if (filters.level) where.push(eq(challenges.level, filters.level as NonNullable<Challenge["level"]>));
  if (filters.subjectId) where.push(eq(challenges.subjectId, filters.subjectId));
  return db
    .select(cardSelect)
    .from(challenges)
    .innerJoin(users, eq(users.id, challenges.creatorId))
    .leftJoin(subjects, eq(subjects.id, challenges.subjectId))
    .leftJoin(exams, eq(exams.id, challenges.examId))
    .where(and(...where))
    .orderBy(asc(challenges.category), asc(challenges.title))
    .limit(200);
}

/** Distinct categories used by published challenges on a day (for filters). */
export async function categoriesForDay(day: string) {
  const rows = await db.selectDistinct({ category: challenges.category }).from(challenges).where(and(eq(challenges.scheduledFor, day), eq(challenges.status, "published"))).orderBy(asc(challenges.category));
  return rows.map((r) => r.category);
}

/** Public view of one challenge (no answers). Any status is returned; callers decide what to show. */
export async function getChallengeCard(id: string): Promise<ChallengeCard | null> {
  const [row] = await db
    .select(cardSelect)
    .from(challenges)
    .innerJoin(users, eq(users.id, challenges.creatorId))
    .leftJoin(subjects, eq(subjects.id, challenges.subjectId))
    .leftJoin(exams, eq(exams.id, challenges.examId))
    .where(eq(challenges.id, id))
    .limit(1);
  return row ?? null;
}

export async function getChallengeStatus(id: string) {
  const row = await db.query.challenges.findFirst({ where: eq(challenges.id, id), columns: { status: true } });
  return row?.status ?? null;
}

/** Creator's own challenge with full questions (including answers) for the editor. */
export async function getChallengeForEdit(creatorId: string, id: string) {
  const c = await db.query.challenges.findFirst({ where: and(eq(challenges.id, id), eq(challenges.creatorId, creatorId)) });
  if (!c) return null;
  const qs = await db.select().from(questions).where(eq(questions.challengeId, c.id)).orderBy(asc(questions.position));
  return { challenge: c, questions: qs };
}

export async function listMyChallenges(creatorId: string) {
  return db
    .select({
      ...cardSelect,
      status: challenges.status,
      reviewNote: challenges.reviewNote,
      createdAt: challenges.createdAt,
      participants: sql<number>`(select count(distinct a.user_id)::int from ${attempts} a where a.challenge_id = ${challenges.id})`,
      completions: sql<number>`(select count(*)::int from ${attempts} a where a.challenge_id = ${challenges.id} and a.status = 'submitted')`,
    })
    .from(challenges)
    .innerJoin(users, eq(users.id, challenges.creatorId))
    .leftJoin(subjects, eq(subjects.id, challenges.subjectId))
    .leftJoin(exams, eq(exams.id, challenges.examId))
    .where(eq(challenges.creatorId, creatorId))
    .orderBy(desc(challenges.scheduledFor), desc(challenges.createdAt))
    .limit(200);
}

/** Questions for an attempt WITHOUT correctKey/explanation. Explicit column list — never `select *`. */
export async function getAttemptQuestions(attemptId: string, userId: string): Promise<{ attempt: Attempt; questions: SafeQuestion[] }> {
  const attempt = await db.query.attempts.findFirst({ where: and(eq(attempts.id, attemptId), eq(attempts.userId, userId)) });
  if (!attempt) throw new DomainError("Attempt not found.");
  const qs = await db
    .select({ id: questions.id, position: questions.position, prompt: questions.prompt, options: questions.options, points: questions.points })
    .from(questions)
    .where(eq(questions.challengeId, attempt.challengeId))
    .orderBy(asc(questions.position));
  return { attempt, questions: qs };
}

/* ------------------------------------------------------------------ */
/* Attempts                                                            */
/* ------------------------------------------------------------------ */

type GradedQuestion = { id: string; position: number; prompt: string; options: { key: string; text: string }[]; points: number; yourKey: string | null; correctKey: string; correct: boolean; explanation: string | null };

export type AttemptResult = {
  attempt: Attempt;
  suspicious: boolean;
  questions: GradedQuestion[];
};

function sanitizeAnswers(raw: Record<string, string>, qs: { id: string; options: { key: string }[] }[]) {
  const byId = new Map(qs.map((q) => [q.id, new Set(q.options.map((o) => o.key))]));
  const out: Record<string, string> = {};
  for (const [qid, key] of Object.entries(raw ?? {})) {
    const keys = byId.get(qid);
    if (!keys) continue; // unknown question id — ignore
    if (typeof key !== "string" || !keys.has(key)) continue; // unknown option — ignore
    out[qid] = key;
  }
  return out;
}

function grade(answers: Record<string, string>, qs: (typeof questions.$inferSelect)[]) {
  let score = 0;
  let maxScore = 0;
  let correctCount = 0;
  const graded: GradedQuestion[] = qs.map((q) => {
    const yourKey = answers[q.id] ?? null;
    const correct = yourKey !== null && yourKey === q.correctKey;
    maxScore += q.points;
    if (correct) {
      score += q.points;
      correctCount += 1;
    }
    return { id: q.id, position: q.position, prompt: q.prompt, options: q.options, points: q.points, yourKey, correctKey: q.correctKey, correct, explanation: q.explanation };
  });
  return { score, maxScore, correctCount, graded };
}

/** Finalise an attempt as submitted or expired. Caller holds the row lock. */
async function finishAttempt(tx: Tx, attempt: Attempt, answers: Record<string, string>, status: "submitted" | "expired", now: Date): Promise<AttemptResult> {
  const qs = await tx.select().from(questions).where(eq(questions.challengeId, attempt.challengeId)).orderBy(asc(questions.position));
  const clean = sanitizeAnswers(answers, qs);
  const { score, maxScore, correctCount, graded } = grade(clean, qs);
  const durationSeconds = Math.max(0, Math.round((now.getTime() - attempt.startedAt.getTime()) / 1000));
  const [row] = await tx
    .update(attempts)
    .set({ status, submittedAt: now, answers: clean, score, maxScore, correctCount, durationSeconds })
    .where(eq(attempts.id, attempt.id))
    .returning();
  if (status === "submitted") {
    const c = await tx.query.challenges.findFirst({ where: eq(challenges.id, attempt.challengeId), columns: { creatorId: true } });
    if (c) {
      await tx
        .insert(engagementEvents)
        .values({ challengeId: attempt.challengeId, creatorId: c.creatorId, userId: attempt.userId, kind: "completed", attemptId: attempt.id })
        .onConflictDoNothing({ target: [engagementEvents.attemptId, engagementEvents.kind] });
    }
  }
  return { attempt: row, suspicious: durationSeconds < MIN_VALID_DURATION_SECONDS, questions: graded };
}

/**
 * Start (or resume) an attempt. Returns the attempt plus answer-safe questions.
 * Resumes an in-progress attempt whose deadline has not passed instead of creating a new one.
 */
export async function startAttempt(userId: string, challengeId: string): Promise<{ attempt: Attempt; questions: SafeQuestion[]; resumed: boolean }> {
  if (!(await rateLimit(`attempt:start:${userId}`, 30, 3600))) throw new DomainError("Too many attempts started. Please wait a while and try again.");
  const now = new Date();
  const dailyCap = await getSetting("challenge.max_attempts_per_user_per_day");
  const out = await db.transaction(async (tx) => {
    // serialise concurrent starts for the same user+challenge
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`attempt:${userId}:${challengeId}`}))`);
    const c = await tx.query.challenges.findFirst({ where: eq(challenges.id, challengeId) });
    if (!c || c.status !== "published") throw new DomainError("This challenge is not available.");
    if (c.creatorId === userId) throw new DomainError("You cannot attempt your own challenge.");
    const w = challengeWindow(c.scheduledFor);
    if (now < w.start) throw new DomainError("This challenge opens at midnight on its scheduled day.");
    if (now > w.end) throw new DomainError("This challenge has closed for the day.");

    const existing = await tx.select().from(attempts).where(and(eq(attempts.challengeId, c.id), eq(attempts.userId, userId))).orderBy(asc(attempts.attemptNo)).for("update");
    // Expire any stale in-progress attempt first (its saved answers are still graded).
    for (const a of existing) {
      if (a.status === "in_progress" && a.deadlineAt.getTime() + SUBMIT_GRACE_MS < now.getTime()) {
        await finishAttempt(tx, a, a.answers, "expired", now);
        a.status = "expired";
      }
    }
    const live = existing.find((a) => a.status === "in_progress");
    if (live) return { attempt: live, resumed: true };

    if (existing.length >= c.maxAttempts) throw new DomainError(c.maxAttempts === 1 ? "You have already attempted this challenge today." : `You have used all ${c.maxAttempts} attempts for this challenge.`);

    const today = challengeWindow(platformDay(now));
    const [{ n: todayCount }] = await tx
      .select({ n: count() })
      .from(attempts)
      .where(and(eq(attempts.userId, userId), sql`${attempts.startedAt} >= ${today.start}`, sql`${attempts.startedAt} <= ${today.end}`));
    if (todayCount >= dailyCap) throw new DomainError(`You have reached the daily limit of ${dailyCap} attempts. Come back tomorrow.`);

    const deadlineAt = new Date(Math.min(now.getTime() + c.timeLimitSeconds * 1000, w.end.getTime()));
    const [attempt] = await tx
      .insert(attempts)
      .values({ challengeId: c.id, userId, attemptNo: existing.length + 1, status: "in_progress", startedAt: now, deadlineAt })
      .returning();
    const completedBefore = existing.some((a) => a.status === "submitted");
    await tx
      .insert(engagementEvents)
      .values({ challengeId: c.id, creatorId: c.creatorId, userId, kind: completedBefore ? "repeat" : "started", attemptId: attempt.id })
      .onConflictDoNothing({ target: [engagementEvents.attemptId, engagementEvents.kind] });
    return { attempt, resumed: false };
  });
  const { questions: qs } = await getAttemptQuestions(out.attempt.id, userId);
  return { attempt: out.attempt, questions: qs, resumed: out.resumed };
}

/** Partial autosave. Only valid while in progress and before the deadline. */
export async function saveAnswers(userId: string, attemptId: string, answers: Record<string, string>) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId))).for("update");
    if (!a) throw new DomainError("Attempt not found.");
    if (a.status !== "in_progress") throw new DomainError("This attempt is already finished.");
    const now = new Date();
    if (a.deadlineAt.getTime() + SUBMIT_GRACE_MS < now.getTime()) {
      await finishAttempt(tx, a, { ...a.answers, ...answers }, "expired", now);
      throw new DomainError("Time is up — your saved answers were submitted as an expired attempt.");
    }
    const qs = await tx.select({ id: questions.id, options: questions.options }).from(questions).where(eq(questions.challengeId, a.challengeId));
    const merged = sanitizeAnswers({ ...a.answers, ...answers }, qs);
    await tx.update(attempts).set({ answers: merged }).where(eq(attempts.id, a.id));
    return { saved: Object.keys(merged).length, deadlineAt: a.deadlineAt };
  });
}

/**
 * Submit and grade. Rejects double submits; a submit after the deadline is recorded as
 * `expired` (answers graded, but it never counts for leaderboards) and reported as such.
 */
export async function submitAttempt(userId: string, attemptId: string, answers: Record<string, string>): Promise<AttemptResult> {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId))).for("update");
    if (!a) throw new DomainError("Attempt not found.");
    if (a.status !== "in_progress") throw new DomainError("This attempt has already been submitted.");
    const now = new Date();
    const merged = { ...a.answers, ...answers };
    if (a.deadlineAt.getTime() + SUBMIT_GRACE_MS < now.getTime()) {
      return finishAttempt(tx, a, merged, "expired", now);
    }
    return finishAttempt(tx, a, merged, "submitted", now);
  });
}

/** Result view of a finished attempt (answers revealed). */
export async function getAttemptResult(userId: string, attemptId: string): Promise<AttemptResult | null> {
  const a = await db.query.attempts.findFirst({ where: and(eq(attempts.id, attemptId), eq(attempts.userId, userId)) });
  if (!a || a.status === "in_progress") return null;
  const qs = await db.select().from(questions).where(eq(questions.challengeId, a.challengeId)).orderBy(asc(questions.position));
  const { graded } = grade(a.answers, qs);
  return { attempt: a, suspicious: (a.durationSeconds ?? 0) < MIN_VALID_DURATION_SECONDS, questions: graded };
}

/** The user's attempts for one challenge (any status), oldest first. */
export async function userAttemptsForChallenge(userId: string, challengeId: string) {
  return db.select().from(attempts).where(and(eq(attempts.challengeId, challengeId), eq(attempts.userId, userId))).orderBy(asc(attempts.attemptNo));
}

/** Cron: expire in-progress attempts whose deadline passed (grades saved answers). */
export async function expireStaleAttempts(limit = 500) {
  const cutoff = new Date(Date.now() - SUBMIT_GRACE_MS);
  const stale = await db.select({ id: attempts.id }).from(attempts).where(and(eq(attempts.status, "in_progress"), lt(attempts.deadlineAt, cutoff))).limit(limit);
  let n = 0;
  for (const { id } of stale) {
    await db.transaction(async (tx) => {
      const [a] = await tx.select().from(attempts).where(eq(attempts.id, id)).for("update");
      if (!a || a.status !== "in_progress") return;
      await finishAttempt(tx, a, a.answers, "expired", new Date());
      n++;
    });
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* History & stats                                                     */
/* ------------------------------------------------------------------ */

export const HISTORY_PAGE_SIZE = 20;

export async function userHistory(userId: string, page = 1, pageSize = HISTORY_PAGE_SIZE) {
  const where = and(eq(attempts.userId, userId), ne(attempts.status, "in_progress"));
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(attempts).where(where),
    db
      .select({
        id: attempts.id,
        challengeId: attempts.challengeId,
        title: challenges.title,
        category: challenges.category,
        subjectName: subjects.name,
        scheduledFor: challenges.scheduledFor,
        attemptNo: attempts.attemptNo,
        status: attempts.status,
        score: attempts.score,
        maxScore: attempts.maxScore,
        correctCount: attempts.correctCount,
        durationSeconds: attempts.durationSeconds,
        submittedAt: attempts.submittedAt,
      })
      .from(attempts)
      .innerJoin(challenges, eq(challenges.id, attempts.challengeId))
      .leftJoin(subjects, eq(subjects.id, challenges.subjectId))
      .where(where)
      .orderBy(desc(attempts.submittedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Best score per challenge for the user's last N finished challenges, oldest first (sparkline input). */
export async function userScoreSeries(userId: string, limit = 30) {
  const rows = await db
    .select({ challengeId: attempts.challengeId, pct: sql<number>`max(case when ${attempts.maxScore} > 0 then round(${attempts.score} * 100.0 / ${attempts.maxScore}) else 0 end)::int`, last: sql<string>`max(${attempts.submittedAt})` })
    .from(attempts)
    .where(and(eq(attempts.userId, userId), eq(attempts.status, "submitted")))
    .groupBy(attempts.challengeId)
    .orderBy(desc(sql`max(${attempts.submittedAt})`))
    .limit(limit);
  return rows.reverse().map((r) => r.pct);
}

/** Consecutive platform days (ending today or yesterday) with ≥1 submitted attempt. */
export async function userStreak(userId: string): Promise<number> {
  const rows = await db.execute<{ day: string }>(sql`
    select distinct to_char(${attempts.submittedAt} at time zone 'Africa/Lagos', 'YYYY-MM-DD') as day
    from ${attempts}
    where ${attempts.userId} = ${userId} and ${attempts.status} = 'submitted'
    order by day desc
    limit 400`);
  const days = new Set(rows.rows.map((r) => r.day));
  if (!days.size) return 0;
  let cursor = platformDayStart(platformDay());
  // A streak is still alive if the user played yesterday but not yet today.
  if (!days.has(platformDay(cursor))) cursor = addDays(cursor, -1);
  let streak = 0;
  while (days.has(platformDay(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export type ChallengeStats = {
  uniqueParticipants: number;
  validAttempts: number;
  completions: number;
  completionRate: number; // 0–1
  repeatParticipants: number;
  avgScorePct: number | null;
};

export async function challengeStats(challengeId: string): Promise<ChallengeStats> {
  const [row] = await db
    .select({
      uniqueParticipants: sql<number>`count(distinct ${attempts.userId})::int`,
      started: sql<number>`count(*)::int`,
      validAttempts: sql<number>`count(*) filter (where ${attempts.status} = 'submitted' and coalesce(${attempts.durationSeconds}, 0) >= ${MIN_VALID_DURATION_SECONDS})::int`,
      completions: sql<number>`count(*) filter (where ${attempts.status} = 'submitted')::int`,
      avgScorePct: sql<number | null>`avg(case when ${attempts.status} = 'submitted' and ${attempts.maxScore} > 0 then ${attempts.score} * 100.0 / ${attempts.maxScore} end)::float`,
    })
    .from(attempts)
    .where(eq(attempts.challengeId, challengeId));
  const [rep] = await db
    .select({ n: sql<number>`count(distinct ${engagementEvents.userId})::int` })
    .from(engagementEvents)
    .where(and(eq(engagementEvents.challengeId, challengeId), eq(engagementEvents.kind, "repeat")));
  return {
    uniqueParticipants: row?.uniqueParticipants ?? 0,
    validAttempts: row?.validAttempts ?? 0,
    completions: row?.completions ?? 0,
    completionRate: row?.started ? row.completions / row.started : 0,
    repeatParticipants: rep?.n ?? 0,
    avgScorePct: row?.avgScorePct == null ? null : Math.round(row.avgScorePct),
  };
}

/** Best submitted (non-suspicious) score per challenge for a user on a set of challenge ids. */
export async function userBestScores(userId: string, challengeIds: string[]) {
  if (!challengeIds.length) return new Map<string, { score: number; maxScore: number; attempts: number; inProgressId: string | null }>();
  const rows = await db
    .select({
      challengeId: attempts.challengeId,
      best: sql<number>`coalesce(max(case when ${attempts.status} = 'submitted' then ${attempts.score} end), 0)::int`,
      maxScore: sql<number>`coalesce(max(${attempts.maxScore}), 0)::int`,
      n: sql<number>`count(*)::int`,
      inProgressId: sql<string | null>`max(case when ${attempts.status} = 'in_progress' then ${attempts.id}::text end)`,
    })
    .from(attempts)
    .where(and(eq(attempts.userId, userId), inArray(attempts.challengeId, challengeIds)))
    .groupBy(attempts.challengeId);
  return new Map(rows.map((r) => [r.challengeId, { score: r.best, maxScore: r.maxScore, attempts: r.n, inProgressId: r.inProgressId }]));
}
