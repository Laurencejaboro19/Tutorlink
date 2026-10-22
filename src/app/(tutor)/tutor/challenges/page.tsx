import Link from "next/link";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { requireTutor } from "@/lib/auth";
import { formatDate } from "@/lib/time";
import { CHALLENGE_STATUS_LABEL, listMyChallenges } from "@/server/challenges";
import { REWARD_STATUS_LABEL, tutorEngagementSummary, tutorRewardHistory } from "@/server/leaderboards";
import { levelLabel } from "@/server/reference";
import { statusTone } from "./status";

export const metadata = { title: "My challenges" };
export const dynamic = "force-dynamic";

export default async function TutorChallengesPage() {
  const user = await requireTutor();
  const [rows, engagement, rewards] = await Promise.all([listMyChallenges(user.id), tutorEngagementSummary(user.id), tutorRewardHistory(user.id)]);
  const e = engagement.score;
  const planLabel = engagement.planCode === "free" ? "Free" : engagement.planCode === "premium" ? "Premium" : "Premium+";
  const prize = engagement.planCode === "free" ? "a month of Premium" : engagement.planCode === "premium" ? "a month of Premium+" : null;

  return (
    <>
      <PageHeader
        eyebrow="Tutor"
        title="My challenges"
        description="Create daily quizzes for students. Engagement on your challenges — not raw attempts — earns plan rewards each leaderboard cycle."
        action={
          <ButtonLink href="/tutor/challenges/new" variant="secondary">
            New challenge
          </ButtonLink>
        }
      />

      <Card className="mb-6">
        <CardHeader
          title="Engagement this cycle"
          description={engagement.cycle ? `${formatDate(engagement.cycle.startsAt)} – ${formatDate(new Date(engagement.cycle.endsAt.getTime() - 1))} · you are on the ${planLabel} plan` : "No leaderboard cycle is open right now."}
          action={<Badge tone={engagement.eligible ? "success" : "neutral"}>{engagement.eligible ? "Eligible" : "Not yet eligible"}</Badge>}
        />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-5">
          <Stat label="Score" value={e.score} hint="1×participants + 2×completions + 1.5×repeat + 10×rate" tone="brand" />
          <Stat label="Unique participants" value={e.uniqueParticipants} hint={`Need ${engagement.minUnique}+`} />
          <Stat label="Completions" value={e.completions} hint={`of ${e.starts} start${e.starts === 1 ? "" : "s"}`} />
          <Stat label="Completion rate" value={`${Math.round(e.completionRate * 100)}%`} hint={`Need ${engagement.minCompletionPct}%+`} />
          <Stat label="Repeat participants" value={e.repeatParticipants} hint="Came back for another attempt" />
        </div>
        <div className="px-5 pb-5 text-sm text-ink-600">
          {prize ? (
            <p>
              The top eligible {planLabel}-plan creator at the end of the cycle earns <strong>{prize}</strong>. Eligibility needs at least {engagement.minUnique} unique participants and a {engagement.minCompletionPct}% completion rate. Your own attempts and brand-new accounts with a single attempt are not counted.
            </p>
          ) : (
            <p>Premium+ creators are recognised on the leaderboard; plan rewards go to the top Free and Premium creators.</p>
          )}
        </div>
      </Card>

      {rewards.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Plan rewards" />
          <ul className="divide-y divide-ink-100 px-5 pb-4">
            {rewards.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span>
                  Cycle ending {formatDate(new Date(r.cycleEndsAt.getTime() - 1))}: one month of <strong>{r.grantedPlan === "premium" ? "Premium" : "Premium+"}</strong> (score {r.engagementScore})
                  {r.reviewNote && <span className="block text-xs text-ink-500">{r.reviewNote}</span>}
                </span>
                <Badge tone={r.status === "credited" ? "success" : r.status === "rejected" ? "danger" : "warning"}>{r.status === "credited" ? "Granted" : REWARD_STATUS_LABEL[r.status]}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Your challenges" description={`${rows.length} challenge${rows.length === 1 ? "" : "s"}`} />
        <div className="px-5 pb-5">
          {rows.length === 0 ? (
            <EmptyState
              title="No challenges yet"
              description="Write a short multiple-choice quiz, schedule it for a day, and submit it for review."
              action={
                <ButtonLink href="/tutor/challenges/new" size="sm">
                  Create your first challenge
                </ButtonLink>
              }
            />
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="tl-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Challenge</th>
                    <th>Day</th>
                    <th>Status</th>
                    <th>Participants</th>
                    <th>Completions</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/tutor/challenges/${c.id}/edit`} className="font-medium text-ink-900 hover:text-brand-600">
                          {c.title}
                        </Link>
                        <p className="text-xs text-ink-500">
                          {c.category}
                          {c.subjectName ? ` · ${c.subjectName}` : ""}
                          {c.level ? ` · ${levelLabel(c.level)}` : ""} · {c.questionCount} q · {c.totalPoints} pts
                        </p>
                      </td>
                      <td className="text-sm text-ink-700">{formatDate(c.scheduledFor)}</td>
                      <td>
                        <Badge tone={statusTone(c.status)}>{CHALLENGE_STATUS_LABEL[c.status]}</Badge>
                        {c.status === "rejected" && c.reviewNote && <p className="mt-1 max-w-[220px] text-xs text-ink-500">{c.reviewNote}</p>}
                      </td>
                      <td className="text-sm text-ink-700">{c.participants}</td>
                      <td className="text-sm text-ink-700">{c.completions}</td>
                      <td className="text-right">
                        <Link href={`/tutor/challenges/${c.id}/edit`} className="text-sm font-semibold text-brand-600 hover:underline">
                          {c.status === "draft" || c.status === "rejected" ? "Edit" : "View"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
