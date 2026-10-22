import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, ButtonLink, PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { formatDate, platformDay } from "@/lib/time";
import { challengeWindow, getAttemptQuestions, getAttemptResult, getChallengeCard, getChallengeStatus, userAttemptsForChallenge, CHALLENGE_STATUS_LABEL } from "@/server/challenges";
import { levelLabel } from "@/server/reference";
import { minutesLabel } from "../format";
import { AttemptClient, type InitialState } from "./attempt-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/challenges/[id]">) {
  const { id } = await params;
  const card = /^[0-9a-f-]{36}$/.test(id) ? await getChallengeCard(id) : null;
  return { title: card ? `${card.title} · Challenge` : "Challenge" };
}

export default async function ChallengePage({ params }: PageProps<"/challenges/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [card, status, user] = await Promise.all([getChallengeCard(id), getChallengeStatus(id), getCurrentUser()]);
  if (!card || !status) notFound();
  const isCreator = user?.id === card.creatorId;
  // Only published (or archived, for past results) challenges are visible to non-creators.
  if (status !== "published" && status !== "archived" && !isCreator && !user?.adminRole) notFound();

  const now = new Date();
  const w = challengeWindow(card.scheduledFor);
  const windowState = now < w.start ? "upcoming" : now > w.end ? "closed" : "open";
  const isToday = card.scheduledFor === platformDay(now);

  let initial: InitialState = { kind: "idle" };
  let attemptsUsed = 0;
  if (user && !isCreator) {
    const mine = await userAttemptsForChallenge(user.id, card.id);
    attemptsUsed = mine.length;
    const live = mine.find((a) => a.status === "in_progress" && a.deadlineAt.getTime() > now.getTime());
    if (live) {
      const { questions } = await getAttemptQuestions(live.id, user.id);
      initial = { kind: "playing", attempt: { id: live.id, challengeId: live.challengeId, attemptNo: live.attemptNo, status: live.status, answers: live.answers, startedAt: live.startedAt.toISOString(), deadlineAt: live.deadlineAt.toISOString() }, questions, resumed: true };
    } else {
      const finished = [...mine].reverse().find((a) => a.status !== "in_progress");
      if (finished) {
        const r = await getAttemptResult(user.id, finished.id);
        if (r) initial = { kind: "result", result: { suspicious: r.suspicious, questions: r.questions, attempt: { id: r.attempt.id, status: r.attempt.status, score: r.attempt.score, maxScore: r.attempt.maxScore, correctCount: r.attempt.correctCount, durationSeconds: r.attempt.durationSeconds } }, rankHint: null };
      }
    }
  }

  const blocked = !user
    ? null
    : isCreator
      ? "This is your own challenge — creators cannot attempt their challenges."
      : status !== "published"
        ? `This challenge is ${CHALLENGE_STATUS_LABEL[status].toLowerCase()}.`
        : windowState === "upcoming"
          ? `Opens on ${formatDate(card.scheduledFor)} at 00:00 (Lagos time).`
          : windowState === "closed"
            ? "This challenge closed at midnight. Check today's challenges for new ones."
            : attemptsUsed >= card.maxAttempts
              ? `You have used all ${card.maxAttempts} attempt${card.maxAttempts === 1 ? "" : "s"}.`
              : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-500">
        <Link href="/challenges" className="hover:text-brand-600">
          Daily challenges
        </Link>{" "}
        / <span className="text-ink-700">{card.category}</span>
      </nav>
      <PageHeader
        eyebrow={isToday ? "Today's challenge" : formatDate(card.scheduledFor)}
        title={card.title}
        description={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <span>by {card.creatorName}</span>
            {card.subjectName && <span>· {card.subjectName}</span>}
            {card.level && <span>· {levelLabel(card.level)}</span>}
            {card.examName && <span>· {card.examName}</span>}
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Badge tone="brand">{card.totalPoints} points</Badge>
            <Badge tone="neutral">
              {card.questionCount} question{card.questionCount === 1 ? "" : "s"}
            </Badge>
            <Badge tone="neutral">{minutesLabel(card.timeLimitSeconds)} limit</Badge>
            {status !== "published" && <Badge tone="warning">{CHALLENGE_STATUS_LABEL[status]}</Badge>}
          </div>
        }
      />
      {card.description && <p className="mb-6 text-[15px] text-ink-700">{card.description}</p>}

      {!user ? (
        <Alert tone="brand" title="Sign in to start this challenge">
          <p className="mb-3">You need a TutorLink account to attempt challenges. It is free.</p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/login?next=/challenges/${card.id}`} size="sm">
              Sign in
            </ButtonLink>
            <ButtonLink href="/register" size="sm" variant="outline">
              Create account
            </ButtonLink>
          </div>
        </Alert>
      ) : (
        <AttemptClient
          challenge={{ id: card.id, title: card.title, timeLimitSeconds: card.timeLimitSeconds, maxAttempts: card.maxAttempts, questionCount: card.questionCount, totalPoints: card.totalPoints, subjectName: card.subjectName, category: card.category }}
          initial={initial}
          attemptsUsed={attemptsUsed}
          blockedReason={blocked}
        />
      )}
    </div>
  );
}
