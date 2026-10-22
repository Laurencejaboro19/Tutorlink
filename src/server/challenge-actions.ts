"use server";

import { z } from "zod";
import { assertRole, assertUser, AuthError } from "@/lib/auth";
import { fail, succeed, toActionError, type ActionResult } from "@/lib/result";
import { parseForm, uuidSchema } from "@/lib/validation";
import {
  archiveChallenge,
  createChallenge,
  getChallengeCard,
  OPTION_KEYS,
  saveAnswers,
  startAttempt,
  submitAttempt,
  submitForReview,
  updateChallenge,
  type Attempt,
  type AttemptResult,
  type SafeQuestion,
} from "@/server/challenges";
import { ensureOpenCycle, liveStandings, userStanding } from "@/server/leaderboards";

type R = ActionResult<{ redirectTo?: string }> | null;

/* ------------------------------------------------------------------ */
/* Tutor authoring                                                     */
/* ------------------------------------------------------------------ */

const questionSchema = z.object({
  prompt: z.string().trim().min(3, "Enter the question").max(2000),
  options: z
    .array(z.object({ key: z.enum(OPTION_KEYS), text: z.string().trim().min(1, "Option text is required").max(500) }))
    .min(2, "Add at least two options")
    .max(6, "At most six options"),
  correctKey: z.enum(OPTION_KEYS),
  explanation: z.string().trim().max(2000).optional().or(z.literal("")),
  points: z.coerce.number().int().min(1).max(50),
});

const optionalInt = z.preprocess((v) => (v === "" || v === undefined || v === null ? null : v), z.coerce.number().int().positive().nullable());

const challengeSchema = z.object({
  id: uuidSchema.optional().or(z.literal("")),
  title: z.string().trim().min(4, "Give the challenge a title (4+ characters)").max(140),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  category: z.string().trim().min(2, "Choose a category").max(60),
  subjectId: optionalInt,
  level: z.enum(["", "primary", "junior_secondary", "senior_secondary", "tertiary", "adult"]).optional(),
  examId: optionalInt,
  scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  timeLimitSeconds: z.coerce.number().int().min(30).max(86_400),
  maxAttempts: z.coerce.number().int().min(1).max(10),
  questionsJson: z.string().min(2, "Add at least one question"),
  intent: z.enum(["save", "submit"]).optional(),
});

export async function saveChallengeAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(challengeSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    const d = parsed.data;
    let rawQuestions: unknown;
    try {
      rawQuestions = JSON.parse(d.questionsJson);
    } catch {
      return fail("Questions could not be read. Reload the page and try again.", { questions: ["Invalid question data"] });
    }
    const qs = z.array(questionSchema).min(1, "Add at least one question").max(50).safeParse(rawQuestions);
    if (!qs.success) {
      const issue = qs.error.issues[0];
      const idx = typeof issue?.path[0] === "number" ? ` (question ${issue.path[0] + 1})` : "";
      return fail(`${issue?.message ?? "Check your questions"}${idx}`, { questions: [`${issue?.message ?? "Check your questions"}${idx}`] });
    }
    const input = {
      title: d.title,
      description: d.description || null,
      category: d.category,
      subjectId: d.subjectId ?? null,
      level: d.level ? d.level : null,
      examId: d.examId ?? null,
      scheduledFor: d.scheduledFor,
      timeLimitSeconds: d.timeLimitSeconds,
      maxAttempts: d.maxAttempts,
      questions: qs.data.map((q) => ({ ...q, explanation: q.explanation || null })),
    };
    const row = d.id ? await updateChallenge(user.id, d.id, input) : await createChallenge(user.id, input);
    if (d.intent === "submit") {
      const after = await submitForReview(user.id, row.id);
      return succeed({ redirectTo: `/tutor/challenges/${row.id}/edit` }, after.status === "published" ? "Challenge published." : "Submitted for review.");
    }
    return succeed({ redirectTo: `/tutor/challenges/${row.id}/edit` }, "Draft saved.");
  } catch (e) {
    return toActionError(e);
  }
}

const idSchema = z.object({ id: uuidSchema });

export async function submitChallengeAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(idSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    const row = await submitForReview(user.id, parsed.data.id);
    return succeed({ redirectTo: `/tutor/challenges/${row.id}/edit` }, row.status === "published" ? "Challenge published." : "Submitted for review. You will be notified when it is approved.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function archiveChallengeAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(idSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await archiveChallenge(user.id, parsed.data.id);
    return succeed({ redirectTo: "/tutor/challenges" }, "Challenge archived.");
  } catch (e) {
    return toActionError(e);
  }
}

/* ------------------------------------------------------------------ */
/* Playing (called directly from the attempt client component)         */
/* ------------------------------------------------------------------ */

async function assertPlayer() {
  const user = await assertUser();
  if (user.onboardingStep !== "complete") throw new AuthError("Finish setting up your account first.");
  return user;
}

const answersSchema = z.record(z.string().uuid(), z.string().max(8));

export type StartPayload = { attempt: Pick<Attempt, "id" | "challengeId" | "attemptNo" | "status" | "answers"> & { startedAt: string; deadlineAt: string }; questions: SafeQuestion[]; resumed: boolean };

export async function startAttemptAction(challengeId: string): Promise<ActionResult<StartPayload>> {
  try {
    const user = await assertPlayer();
    const id = uuidSchema.parse(challengeId);
    const { attempt, questions, resumed } = await startAttempt(user.id, id);
    return succeed({
      attempt: { id: attempt.id, challengeId: attempt.challengeId, attemptNo: attempt.attemptNo, status: attempt.status, answers: attempt.answers, startedAt: attempt.startedAt.toISOString(), deadlineAt: attempt.deadlineAt.toISOString() },
      questions,
      resumed,
    });
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveAnswersAction(attemptId: string, answers: Record<string, string>): Promise<ActionResult<{ saved: number }>> {
  try {
    const user = await assertPlayer();
    const parsed = answersSchema.safeParse(answers);
    if (!parsed.success) return fail("Invalid answers.");
    const out = await saveAnswers(user.id, uuidSchema.parse(attemptId), parsed.data);
    return succeed({ saved: out.saved });
  } catch (e) {
    return toActionError(e);
  }
}

export type RankHint = { rank: number; total: number; scopeLabel: string } | null;

export type SubmitPayload = {
  result: Omit<AttemptResult, "attempt"> & { attempt: Pick<Attempt, "id" | "status" | "score" | "maxScore" | "correctCount" | "durationSeconds"> };
  rankHint: RankHint;
};

export async function submitAttemptAction(attemptId: string, answers: Record<string, string>): Promise<ActionResult<SubmitPayload>> {
  try {
    const user = await assertPlayer();
    const parsed = answersSchema.safeParse(answers);
    if (!parsed.success) return fail("Invalid answers.");
    const result = await submitAttempt(user.id, uuidSchema.parse(attemptId), parsed.data);
    let rankHint: RankHint = null;
    if (result.attempt.status === "submitted" && !result.suspicious) {
      const card = await getChallengeCard(result.attempt.challengeId);
      const cycle = await ensureOpenCycle();
      const scope = card?.subjectId ? ("subject" as const) : ("nationwide" as const);
      const standing = await userStanding({ scope, scopeKey: card?.subjectId ? String(card.subjectId) : "all", cycleId: cycle.id, userId: user.id });
      if (standing) {
        const { total } = await liveStandings({ scope, scopeKey: card?.subjectId ? String(card.subjectId) : "all", cycleId: cycle.id, limit: 1 });
        rankHint = { rank: standing.rank, total, scopeLabel: card?.subjectId && card.subjectName ? `in ${card.subjectName} this cycle` : "nationwide this cycle" };
      }
    }
    const a = result.attempt;
    return succeed({
      result: { suspicious: result.suspicious, questions: result.questions, attempt: { id: a.id, status: a.status, score: a.score, maxScore: a.maxScore, correctCount: a.correctCount, durationSeconds: a.durationSeconds } },
      rankHint,
    });
  } catch (e) {
    return toActionError(e);
  }
}
