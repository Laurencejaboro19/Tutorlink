"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Alert, Badge, Button, ButtonLink, Card, CardHeader, cn } from "@/components/ui";
import { saveAnswersAction, startAttemptAction, submitAttemptAction, type RankHint, type StartPayload, type SubmitPayload } from "@/server/challenge-actions";
import { clockLabel, durationLabel } from "../format";

export type InitialState = { kind: "idle" } | ({ kind: "playing" } & StartPayload) | ({ kind: "result" } & SubmitPayload);

type ChallengeMeta = { id: string; title: string; timeLimitSeconds: number; maxAttempts: number; questionCount: number; totalPoints: number; subjectName: string | null; category: string };

type State = InitialState & { error?: string };

const AUTOSAVE_DELAY_MS = 800;

export function AttemptClient({ challenge, initial, attemptsUsed, blockedReason }: { challenge: ChallengeMeta; initial: InitialState; attemptsUsed: number; blockedReason: string | null }) {
  const [state, setState] = useState<State>(initial);
  const [used, setUsed] = useState(attemptsUsed);
  const [pending, startTransition] = useTransition();

  const start = () => {
    startTransition(async () => {
      const res = await startAttemptAction(challenge.id);
      if (!res.ok) {
        setState((s) => ({ ...s, error: res.error }));
        return;
      }
      if (!res.data!.resumed) setUsed((u) => u + 1);
      setState({ kind: "playing", ...res.data! });
    });
  };

  if (state.kind === "playing") {
    return <Play key={state.attempt.id} challenge={challenge} payload={state} onDone={(p) => setState({ kind: "result", ...p })} />;
  }

  const canStart = !blockedReason && used < challenge.maxAttempts;

  return (
    <div className="space-y-6">
      {state.kind === "result" && <ResultView challenge={challenge} payload={state} />}
      {state.error && (
        <Alert tone="danger" title="Could not start">
          {state.error}
        </Alert>
      )}
      <Card className="p-5">
        {blockedReason ? (
          <p className="text-sm text-ink-700" role="status">
            {blockedReason}
          </p>
        ) : (
          <>
            <h2 className="text-base font-semibold text-ink-900">{state.kind === "result" ? "Try again?" : "Ready?"}</h2>
            <ul className="mt-2 space-y-1 text-sm text-ink-600">
              <li>
                {challenge.questionCount} multiple-choice question{challenge.questionCount === 1 ? "" : "s"} worth {challenge.totalPoints} points in total.
              </li>
              <li>The timer starts when you press Start: {clockLabel(challenge.timeLimitSeconds)} (mm:ss), or until midnight Lagos time, whichever is first.</li>
              <li>Answers are saved automatically; you can change them until you submit. Correct answers are revealed only after you submit.</li>
              <li>
                Attempts used: {used} of {challenge.maxAttempts}. Only your best submitted attempt counts for the leaderboard.
              </li>
            </ul>
          </>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {canStart && (
            <Button onClick={start} loading={pending} size="lg">
              {state.kind === "result" ? "Start another attempt" : "Start challenge"}
            </Button>
          )}
          <ButtonLink href="/challenges" variant="outline" size="lg">
            All challenges
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Playing                                                             */
/* ------------------------------------------------------------------ */

function Play({ challenge, payload, onDone }: { challenge: ChallengeMeta; payload: StartPayload; onDone: (p: SubmitPayload) => void }) {
  const { attempt, questions } = payload;
  const [answers, setAnswers] = useState<Record<string, string>>(attempt.answers ?? {});
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const deadline = new Date(attempt.deadlineAt).getTime();
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.round((deadline - Date.now()) / 1000)));
  const answersRef = useRef<Record<string, string>>(attempt.answers ?? {});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittedRef = useRef(false);
  const autoSubmittedRef = useRef(false);

  const submit = useCallback(
    (auto = false) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      startSubmit(async () => {
        const res = await submitAttemptAction(attempt.id, answersRef.current);
        if (!res.ok) {
          submittedRef.current = false;
          setError(auto ? `Time is up but the submission failed: ${res.error}` : res.error);
          return;
        }
        onDone(res.data!);
      });
    },
    [attempt.id, onDone],
  );

  // countdown
  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true;
        submit(true);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline, submit]);

  // debounced autosave
  const scheduleSave = (next: Record<string, string>) => {
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (submittedRef.current) return;
      setSaveState("saving");
      const res = await saveAnswersAction(attempt.id, next);
      setSaveState(res.ok ? "saved" : "error");
      if (!res.ok) setError(res.error);
    }, AUTOSAVE_DELAY_MS);
  };
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const choose = (qid: string, key: string) => {
    const next = { ...answersRef.current, [qid]: key };
    answersRef.current = next;
    setAnswers(next);
    scheduleSave(next);
  };

  const answered = questions.filter((q) => answers[q.id]).length;
  const unanswered = questions.length - answered;
  const low = remaining <= 60;

  return (
    <div className="space-y-5">
      <div className={cn("sticky top-16 z-30 -mx-4 flex items-center justify-between gap-3 border-b bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-[var(--radius-md)] sm:border", low ? "border-amber-300" : "border-ink-100")}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Time left</p>
          <p className={cn("font-mono text-2xl font-bold tabular-nums", low ? "text-warning-600" : "text-ink-900")} aria-live={low ? "assertive" : "off"} aria-atomic="true">
            {clockLabel(remaining)}
            {low && <span className="ml-2 text-sm font-semibold">— less than a minute</span>}
          </p>
          <p className="sr-only" aria-live="polite">
            {remaining > 0 && remaining % 60 === 0 ? `${remaining / 60} minutes left` : ""}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold text-ink-900">
            {answered}/{questions.length} answered
          </p>
          <p className="text-xs text-ink-500" role="status">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "dirty" ? "Unsaved changes" : saveState === "error" ? "Save failed — will retry on next change" : payload.resumed ? "Resumed attempt" : "Autosave on"}
          </p>
        </div>
      </div>

      {error && (
        <Alert tone="danger" title="Something went wrong">
          {error}
        </Alert>
      )}

      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={q.id}>
            <fieldset className="tl-card p-5">
              <legend className="sr-only">
                Question {i + 1} of {questions.length}
              </legend>
              <div className="mb-3 flex items-start justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Question {i + 1} of {questions.length}
                </p>
                <Badge tone="neutral">
                  {q.points} pt{q.points === 1 ? "" : "s"}
                </Badge>
              </div>
              <p className="text-[15px] font-medium text-ink-900 whitespace-pre-wrap">{q.prompt}</p>
              <div className="mt-4 grid gap-2">
                {q.options.map((o) => {
                  const checked = answers[q.id] === o.key;
                  return (
                    <label key={o.key} className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500", checked ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:border-ink-300")}>
                      <input type="radio" name={`q-${q.id}`} value={o.key} checked={checked} onChange={() => choose(q.id, o.key)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
                      <span className="font-semibold text-ink-700">{o.key}.</span>
                      <span className="text-ink-900">{o.text}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>

      <div className="tl-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-600" role="status">
          {unanswered === 0 ? "All questions answered." : `${unanswered} question${unanswered === 1 ? "" : "s"} unanswered — unanswered questions score 0.`}
        </p>
        <Button size="lg" onClick={() => submit(false)} loading={submitting} disabled={remaining === 0}>
          Submit answers
        </Button>
      </div>
      <p className="text-xs text-ink-400">Challenge: {challenge.title}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */

function ResultView({ challenge, payload }: { challenge: ChallengeMeta; payload: SubmitPayload }) {
  const { result, rankHint } = payload;
  const a = result.attempt;
  const pct = a.maxScore ? Math.round((a.score / a.maxScore) * 100) : 0;
  const expired = a.status === "expired";
  return (
    <section aria-labelledby="result-heading" className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="result-heading" className="text-lg font-semibold text-ink-900">
              {expired ? "Time ran out" : "Your result"}
            </h2>
            <p className="mt-1 text-sm text-ink-600">
              {a.correctCount} of {result.questions.length} correct · {durationLabel(a.durationSeconds)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-ink-900">
              {a.score}
              <span className="text-base font-medium text-ink-400">/{a.maxScore}</span>
            </p>
            <p className="text-xs text-ink-500">{pct}%</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={expired ? "warning" : "success"}>{expired ? "Expired — not counted for the leaderboard" : "Submitted"}</Badge>
          {result.suspicious && !expired && <Badge tone="warning">Finished in under 5 s — not counted for the leaderboard</Badge>}
        </div>
        {rankHint && (
          <p className="mt-3 text-sm text-ink-700">
            You are <strong>#{rankHint.rank}</strong> of {rankHint.total} {rankHint.scopeLabel}.{" "}
            <Link href="/leaderboard" className="font-semibold text-brand-600 hover:underline">
              See the leaderboard
            </Link>
          </p>
        )}
      </Card>
      <RankHintNote hint={rankHint} />
      <Card>
        <CardHeader title="Answers & explanations" description={`${challenge.category}${challenge.subjectName ? ` · ${challenge.subjectName}` : ""}`} />
        <ol className="divide-y divide-ink-100">
          {result.questions.map((q, i) => (
            <li key={q.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15px] font-medium text-ink-900 whitespace-pre-wrap">
                  <span className="mr-1 text-ink-400">{i + 1}.</span>
                  {q.prompt}
                </p>
                <Badge tone={q.correct ? "success" : "danger"}>{q.correct ? `Correct +${q.points}` : "Incorrect"}</Badge>
              </div>
              <ul className="mt-3 grid gap-1.5 text-sm">
                {q.options.map((o) => {
                  const isCorrect = o.key === q.correctKey;
                  const isYours = o.key === q.yourKey;
                  return (
                    <li key={o.key} className={cn("flex gap-2 rounded-[var(--radius-sm)] px-3 py-1.5", isCorrect ? "bg-success-100 text-success-600" : isYours ? "bg-danger-100 text-danger-600" : "text-ink-600")}>
                      <span className="font-semibold">{o.key}.</span>
                      <span className="flex-1">{o.text}</span>
                      {isCorrect && <span className="text-xs font-semibold">Correct answer</span>}
                      {isYours && !isCorrect && <span className="text-xs font-semibold">Your answer</span>}
                    </li>
                  );
                })}
                {!q.yourKey && <li className="px-3 text-xs text-ink-400">You did not answer this question.</li>}
              </ul>
              {q.explanation && <p className="mt-3 rounded-[var(--radius-sm)] bg-ink-50 px-3 py-2 text-sm text-ink-700">{q.explanation}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

function RankHintNote({ hint }: { hint: RankHint }) {
  if (hint) return null;
  return <p className="text-xs text-ink-400">Leaderboard position appears after a counted submission. Your full history is in your dashboard.</p>;
}
