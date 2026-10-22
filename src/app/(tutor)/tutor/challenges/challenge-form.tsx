"use client";

import { useId, useState } from "react";
import { ActionForm, FieldError, useFormResult } from "@/components/action-form";
import { Button, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { saveChallengeAction } from "@/server/challenge-actions";
import { CATEGORIES } from "./categories";

const KEYS = ["A", "B", "C", "D", "E", "F"] as const;

export type QuestionDraft = { prompt: string; options: { key: string; text: string }[]; correctKey: string; explanation: string; points: number };

export type ChallengeDraft = {
  id?: string;
  title: string;
  description: string;
  category: string;
  subjectId: number | null;
  level: string;
  examId: number | null;
  scheduledFor: string;
  timeLimitSeconds: number;
  maxAttempts: number;
  questions: QuestionDraft[];
};

function blankQuestion(): QuestionDraft {
  return { prompt: "", options: KEYS.slice(0, 4).map((k) => ({ key: k, text: "" })), correctKey: "A", explanation: "", points: 10 };
}

function SubmitButtons({ isNew, canSubmitForReview }: { isNew: boolean; canSubmitForReview: boolean }) {
  const { pending } = useFormResult();
  return (
    <div className="mt-6 flex flex-col gap-2 sm:flex-row">
      <Button type="submit" name="intent" value="save" variant="outline" loading={pending}>
        {isNew ? "Save draft" : "Save changes"}
      </Button>
      {canSubmitForReview && (
        <Button type="submit" name="intent" value="submit" loading={pending}>
          Save &amp; submit for review
        </Button>
      )}
    </div>
  );
}

export function ChallengeForm({
  initial,
  subjects,
  exams,
  levels,
  minDay,
  directPublish,
}: {
  initial: ChallengeDraft;
  subjects: { id: number; name: string; category: string }[];
  exams: { id: number; name: string }[];
  levels: readonly { value: string; label: string }[];
  minDay: string;
  directPublish: boolean;
}) {
  const [questions, setQuestions] = useState<QuestionDraft[]>(initial.questions.length ? initial.questions : [blankQuestion()]);
  const baseId = useId();

  const update = (i: number, patch: Partial<QuestionDraft>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, dir: -1 | 1) =>
    setQuestions((qs) => {
      const j = i + dir;
      if (j < 0 || j >= qs.length) return qs;
      const next = [...qs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i: number) => setQuestions((qs) => (qs.length === 1 ? qs : qs.filter((_, j) => j !== i)));
  const addOption = (i: number) =>
    setQuestions((qs) =>
      qs.map((q, j) => {
        if (j !== i || q.options.length >= 6) return q;
        return { ...q, options: [...q.options, { key: KEYS[q.options.length], text: "" }] };
      }),
    );
  const removeOption = (i: number) =>
    setQuestions((qs) =>
      qs.map((q, j) => {
        if (j !== i || q.options.length <= 2) return q;
        const options = q.options.slice(0, -1);
        return { ...q, options, correctKey: options.some((o) => o.key === q.correctKey) ? q.correctKey : "A" };
      }),
    );
  const totalPoints = questions.reduce((a, q) => a + (Number(q.points) || 0), 0);

  return (
    <ActionForm action={saveChallengeAction} hideSubmit className="space-y-6">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="questionsJson" value={JSON.stringify(questions)} readOnly />

      <section className="tl-card space-y-4 p-5">
        <h2 className="text-base font-semibold text-ink-900">Challenge details</h2>
        <Field label="Title" name="title" required help="What students see on the challenge card, e.g. “WAEC Chemistry: mole concept”.">
          <Input id="title" name="title" defaultValue={initial.title} maxLength={140} required />
          <FieldError name="title" />
        </Field>
        <Field label="Description" name="description" help="Optional. What the quiz covers and who it is for.">
          <Textarea id="description" name="description" defaultValue={initial.description} maxLength={2000} className="min-h-[80px]" />
          <FieldError name="description" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" name="category" required help="One published challenge per category per day.">
            <Select id="category" name="category" defaultValue={initial.category || CATEGORIES[0]} required>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <FieldError name="category" />
          </Field>
          <Field label="Subject" name="subjectId" help="Powers the subject leaderboard.">
            <Select id="subjectId" name="subjectId" defaultValue={initial.subjectId ?? ""}>
              <option value="">No specific subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <FieldError name="subjectId" />
          </Field>
          <Field label="Level" name="level">
            <Select id="level" name="level" defaultValue={initial.level}>
              <option value="">Any level</option>
              {levels.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
            <FieldError name="level" />
          </Field>
          <Field label="Exam" name="examId">
            <Select id="examId" name="examId" defaultValue={initial.examId ?? ""}>
              <option value="">Not exam-specific</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
            <FieldError name="examId" />
          </Field>
          <Field label="Scheduled day" name="scheduledFor" required help="Opens 00:00 and closes 23:59 Lagos time on this day.">
            <Input id="scheduledFor" name="scheduledFor" type="date" defaultValue={initial.scheduledFor} min={minDay} required />
            <FieldError name="scheduledFor" />
          </Field>
          <Field label="Time limit" name="timeLimitSeconds" required>
            <Select id="timeLimitSeconds" name="timeLimitSeconds" defaultValue={initial.timeLimitSeconds}>
              {[120, 300, 600, 900, 1200, 1800, 3600].map((s) => (
                <option key={s} value={s}>
                  {s / 60} minutes
                </option>
              ))}
            </Select>
            <FieldError name="timeLimitSeconds" />
          </Field>
          <Field label="Attempts per student" name="maxAttempts" required help="Only the best attempt counts for the leaderboard.">
            <Select id="maxAttempts" name="maxAttempts" defaultValue={initial.maxAttempts}>
              {[1, 2, 3, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <FieldError name="maxAttempts" />
          </Field>
        </div>
      </section>

      <section aria-labelledby={`${baseId}-questions`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 id={`${baseId}-questions`} className="text-base font-semibold text-ink-900">
            Questions <span className="text-sm font-normal text-ink-500">({questions.length}, {totalPoints} points)</span>
          </h2>
        </div>
        <FieldError name="questions" />
        <ol className="space-y-4">
          {questions.map((q, i) => (
            <li key={i} className="tl-card p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Question {i + 1}</p>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move question ${i + 1} up`}>
                    ↑
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => move(i, 1)} disabled={i === questions.length - 1} aria-label={`Move question ${i + 1} down`}>
                    ↓
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)} disabled={questions.length === 1} aria-label={`Remove question ${i + 1}`}>
                    Remove
                  </Button>
                </div>
              </div>
              <Field label="Question" name={`${baseId}-q${i}-prompt`} required>
                <Textarea id={`${baseId}-q${i}-prompt`} value={q.prompt} onChange={(e) => update(i, { prompt: e.target.value })} maxLength={2000} className="min-h-[72px]" required />
              </Field>
              <fieldset className="mt-4">
                <legend className="tl-label">Options — tick the correct one</legend>
                <div className="space-y-2">
                  {q.options.map((o, k) => {
                    const correct = q.correctKey === o.key;
                    return (
                      <div key={o.key} className={cn("flex items-center gap-2 rounded-[var(--radius-md)] border p-2", correct ? "border-teal-400 bg-teal-50" : "border-ink-200")}>
                        <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-[var(--radius-sm)] text-sm font-semibold text-ink-700">
                          <input type="radio" name={`${baseId}-q${i}-correct`} value={o.key} checked={correct} onChange={() => update(i, { correctKey: o.key })} className="accent-teal-600" aria-label={`Option ${o.key} is correct`} />
                          {o.key}
                        </label>
                        <Input
                          aria-label={`Option ${o.key} text`}
                          value={o.text}
                          maxLength={500}
                          required
                          onChange={(e) => update(i, { options: q.options.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => addOption(i)} disabled={q.options.length >= 6}>
                    Add option
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeOption(i)} disabled={q.options.length <= 2}>
                    Remove last option
                  </Button>
                </div>
              </fieldset>
              <div className="mt-4 grid gap-4 sm:grid-cols-[120px_1fr]">
                <Field label="Points" name={`${baseId}-q${i}-points`} required help="1–50">
                  <Input id={`${baseId}-q${i}-points`} type="number" inputMode="numeric" min={1} max={50} value={q.points} onChange={(e) => update(i, { points: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} required />
                </Field>
                <Field label="Explanation" name={`${baseId}-q${i}-explanation`} help="Shown after submission. Explain why the answer is right.">
                  <Textarea id={`${baseId}-q${i}-explanation`} value={q.explanation} onChange={(e) => update(i, { explanation: e.target.value })} maxLength={2000} className="min-h-[60px]" />
                </Field>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-3">
          <Button type="button" variant="secondary" onClick={() => setQuestions((qs) => [...qs, blankQuestion()])} disabled={questions.length >= 50}>
            Add question
          </Button>
        </div>
      </section>

      <p className="text-sm text-ink-500">{directPublish ? "Your challenges publish immediately when you submit." : "Submitted challenges are reviewed by TutorLink before they go live. You will be notified either way."}</p>
      <SubmitButtons isNew={!initial.id} canSubmitForReview />
    </ActionForm>
  );
}
