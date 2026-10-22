import Link from "next/link";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader, Pagination, Stat, type Tone } from "@/components/ui";
import { requireStudent } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/time";
import { ATTEMPT_STATUS_LABEL, MIN_VALID_DURATION_SECONDS, userHistory, userScoreSeries, userStreak } from "@/server/challenges";
import { durationLabel } from "@/app/(public)/challenges/format";

export const metadata = { title: "My challenges" };
export const dynamic = "force-dynamic";

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <p className="text-sm text-ink-500">Complete at least two challenges to see your trend.</p>;
  const w = 320;
  const h = 80;
  const pad = 6;
  const step = (w - pad * 2) / (values.length - 1);
  const y = (v: number) => h - pad - (v / 100) * (h - pad * 2);
  const points = values.map((v, i) => `${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full max-w-md" role="img" aria-label={`Score trend across your last ${values.length} challenges: latest ${last}%, average ${avg}%`}>
        <line x1={pad} x2={w - pad} y1={y(50)} y2={y(50)} stroke="currentColor" className="text-ink-100" strokeDasharray="3 3" />
        <polyline points={points} fill="none" stroke="currentColor" className="text-brand-600" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {values.map((v, i) => (
          <circle key={i} cx={(pad + i * step).toFixed(1)} cy={y(v).toFixed(1)} r="3" fill="currentColor" className={i === values.length - 1 ? "text-teal-500" : "text-brand-600"} />
        ))}
      </svg>
      <figcaption className="mt-1 text-xs text-ink-500">
        Best score per challenge (%), oldest to newest · latest {last}% · average {avg}%
      </figcaption>
    </figure>
  );
}

function tone(status: "submitted" | "expired" | "in_progress"): Tone {
  return status === "submitted" ? "success" : status === "expired" ? "warning" : "neutral";
}

export default async function StudentChallengesPage({ searchParams }: PageProps<"/dashboard/challenges">) {
  const user = await requireStudent();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const [history, series, streak] = await Promise.all([userHistory(user.id, page), userScoreSeries(user.id), userStreak(user.id)]);
  const submitted = history.rows.filter((r) => r.status === "submitted");
  const avgPct = series.length ? Math.round(series.reduce((a, b) => a + b, 0) / series.length) : null;

  return (
    <>
      <PageHeader
        eyebrow="Student"
        title="My challenges"
        description="Every attempt you have submitted, your streak and how your scores are trending."
        action={
          <ButtonLink href="/challenges" variant="secondary">
            Today&apos;s challenges
          </ButtonLink>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Current streak" value={`${streak} day${streak === 1 ? "" : "s"}`} hint="Consecutive days with a submitted attempt" tone="teal" />
        <Stat label="Attempts" value={history.total} hint="Submitted or expired" />
        <Stat label="Average score" value={avgPct === null ? "—" : `${avgPct}%`} hint={`Across your last ${series.length} challenge${series.length === 1 ? "" : "s"}`} />
      </div>

      <Card className="mb-6">
        <CardHeader title="Improvement" description="Best score per challenge over time" />
        <div className="px-5 pb-5">
          <Sparkline values={series} />
        </div>
      </Card>

      <Card>
        <CardHeader title="History" description={`${history.total} attempt${history.total === 1 ? "" : "s"}`} />
        <div className="px-5 pb-5">
          {history.rows.length === 0 ? (
            <EmptyState
              title="No attempts yet"
              description="Take today's challenge to start your streak."
              action={
                <ButtonLink href="/challenges" size="sm">
                  Browse challenges
                </ButtonLink>
              }
            />
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="tl-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>Challenge</th>
                    <th>Day</th>
                    <th>Score</th>
                    <th>Time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/challenges/${r.challengeId}`} className="font-medium text-ink-900 hover:text-brand-600">
                          {r.title}
                        </Link>
                        <p className="text-xs text-ink-500">
                          {r.category}
                          {r.subjectName ? ` · ${r.subjectName}` : ""} · attempt {r.attemptNo}
                        </p>
                      </td>
                      <td className="text-sm text-ink-700">
                        {formatDate(r.scheduledFor)}
                        {r.submittedAt && <p className="text-xs text-ink-400">{formatDateTime(r.submittedAt)}</p>}
                      </td>
                      <td className="text-sm font-semibold text-ink-900">
                        {r.score}/{r.maxScore}
                        <p className="text-xs font-normal text-ink-500">{r.correctCount} correct</p>
                      </td>
                      <td className="text-sm text-ink-700">{durationLabel(r.durationSeconds)}</td>
                      <td>
                        <Badge tone={tone(r.status)}>{ATTEMPT_STATUS_LABEL[r.status]}</Badge>
                        {r.status === "submitted" && (r.durationSeconds ?? 0) < MIN_VALID_DURATION_SECONDS && <p className="mt-1 text-xs text-warning-600">Too fast — not counted</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={history.page} pageCount={history.pageCount} hrefFor={(p) => `/dashboard/challenges?page=${p}`} />
        </div>
      </Card>
      {submitted.length > 0 && <p className="mt-4 text-xs text-ink-400">Only your best submitted attempt per challenge counts towards the leaderboard.</p>}
    </>
  );
}
