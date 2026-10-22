import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Badge, ButtonLink, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { requireTutor } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { formatDate, platformDay } from "@/lib/time";
import { archiveChallengeAction, submitChallengeAction } from "@/server/challenge-actions";
import { CHALLENGE_STATUS_LABEL, challengeStats, getChallengeForEdit } from "@/server/challenges";
import { LEVELS, levelLabel, listExams, listSubjects } from "@/server/reference";
import { minutesLabel } from "@/app/(public)/challenges/format";
import { ChallengeForm } from "../../challenge-form";
import { statusTone } from "../../status";

export const metadata = { title: "Edit challenge" };
export const dynamic = "force-dynamic";

export default async function EditChallengePage({ params }: PageProps<"/tutor/challenges/[id]/edit">) {
  const user = await requireTutor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getChallengeForEdit(user.id, id);
  if (!data) notFound();
  const { challenge: c, questions } = data;
  const editable = c.status === "draft" || c.status === "rejected";
  const [subjects, exams, requireReview, stats] = await Promise.all([listSubjects(), listExams(), getSetting("challenge.require_review_for_tutor_challenges"), challengeStats(c.id)]);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-500">
        <Link href="/tutor/challenges" className="hover:text-brand-600">
          My challenges
        </Link>{" "}
        / <span className="text-ink-700">{c.title}</span>
      </nav>
      <PageHeader
        eyebrow="Tutor"
        title={editable ? "Edit challenge" : c.title}
        description={`${c.category} · scheduled ${formatDate(c.scheduledFor)} · ${questions.length} question${questions.length === 1 ? "" : "s"}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(c.status)}>{CHALLENGE_STATUS_LABEL[c.status]}</Badge>
            {c.status === "published" && (
              <ButtonLink href={`/challenges/${c.id}`} variant="outline" size="sm">
                Public page
              </ButtonLink>
            )}
          </div>
        }
      />

      {c.status === "rejected" && c.reviewNote && (
        <Alert tone="danger" title="Changes requested by the reviewer" className="mb-6">
          {c.reviewNote}
        </Alert>
      )}
      {c.status === "in_review" && (
        <Alert tone="warning" title="In review" className="mb-6">
          TutorLink is reviewing this challenge. It is read-only until a decision is made. You will be notified.
        </Alert>
      )}
      {c.status === "published" && (
        <Alert tone="success" title="Published" className="mb-6">
          Published challenges cannot be edited (students may already have attempted it). You can archive it if something is wrong.
        </Alert>
      )}

      {editable ? (
        <ChallengeForm
          initial={{
            id: c.id,
            title: c.title,
            description: c.description ?? "",
            category: c.category,
            subjectId: c.subjectId,
            level: c.level ?? "",
            examId: c.examId,
            scheduledFor: c.scheduledFor,
            timeLimitSeconds: c.timeLimitSeconds,
            maxAttempts: c.maxAttempts,
            questions: questions.map((q) => ({ prompt: q.prompt, options: q.options, correctKey: q.correctKey, explanation: q.explanation ?? "", points: q.points })),
          }}
          subjects={subjects.map((s) => ({ id: s.id, name: s.name, category: s.category }))}
          exams={exams.map((e) => ({ id: e.id, name: e.name }))}
          levels={LEVELS}
          minDay={platformDay()}
          directPublish={Boolean(user.adminRole) || !requireReview}
        />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-4">
            <Stat label="Participants" value={stats.uniqueParticipants} hint="Unique students" />
            <Stat label="Completions" value={stats.completions} hint={`${Math.round(stats.completionRate * 100)}% completion rate`} />
            <Stat label="Repeat participants" value={stats.repeatParticipants} hint="Attempted more than once" />
            <Stat label="Average score" value={stats.avgScorePct === null ? "—" : `${stats.avgScorePct}%`} hint={`${stats.validAttempts} counted attempt${stats.validAttempts === 1 ? "" : "s"}`} />
          </div>
          <Card className="mb-6">
            <CardHeader title="Details" />
            <dl className="grid gap-x-6 gap-y-2 px-5 pb-5 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-500">Subject / level / exam</dt>
                <dd className="text-ink-900">{[subjects.find((s) => s.id === c.subjectId)?.name, c.level ? levelLabel(c.level) : null, exams.find((e) => e.id === c.examId)?.name].filter(Boolean).join(" · ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Time limit / attempts</dt>
                <dd className="text-ink-900">
                  {minutesLabel(c.timeLimitSeconds)} · {c.maxAttempts} attempt{c.maxAttempts === 1 ? "" : "s"} per student
                </dd>
              </div>
              {c.description && (
                <div className="sm:col-span-2">
                  <dt className="text-ink-500">Description</dt>
                  <dd className="text-ink-900">{c.description}</dd>
                </div>
              )}
            </dl>
          </Card>
          <Card className="mb-6">
            <CardHeader title="Questions" description="Read-only. Correct answers are marked for you as the creator." />
            <ol className="divide-y divide-ink-100">
              {questions.map((q, i) => (
                <li key={q.id} className="px-5 py-4">
                  <p className="font-medium text-ink-900 whitespace-pre-wrap">
                    <span className="mr-1 text-ink-400">{i + 1}.</span>
                    {q.prompt} <span className="text-xs text-ink-400">({q.points} pts)</span>
                  </p>
                  <ul className="mt-2 grid gap-1 text-sm">
                    {q.options.map((o) => (
                      <li key={o.key} className={o.key === q.correctKey ? "font-semibold text-success-600" : "text-ink-700"}>
                        {o.key}. {o.text}
                        {o.key === q.correctKey && " ✓"}
                      </li>
                    ))}
                  </ul>
                  {q.explanation && <p className="mt-2 text-sm text-ink-500">{q.explanation}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}

      {c.status !== "archived" && (
        <Card className="mt-6">
          <CardHeader title="Actions" />
          <div className="flex flex-col gap-3 px-5 pb-5 sm:flex-row">
            {editable && questions.length > 0 && (
              <ActionForm action={submitChallengeAction} hideSubmit>
                <input type="hidden" name="id" value={c.id} />
                <SubmitButton>{user.adminRole || !requireReview ? "Publish now" : "Submit for review"}</SubmitButton>
              </ActionForm>
            )}
            <ActionForm action={archiveChallengeAction} hideSubmit>
              <input type="hidden" name="id" value={c.id} />
              <SubmitButton variant="danger">Archive</SubmitButton>
            </ActionForm>
          </div>
        </Card>
      )}
    </>
  );
}

