import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/time";
import { getChallengeDetailForAdmin } from "@/server/admin";
import { humanize } from "../../_components/labels";
import { AuditTrail, DL, StatusBadge, When } from "../../_components/table";
import { ArchiveChallengeForm, ReviewChallengeForm } from "../challenge-actions";

export const dynamic = "force-dynamic";

export default async function AdminChallengeDetailPage({ params }: PageProps<"/admin/challenges/[id]">) {
  const viewer = await requireAdmin();
  const { id } = await params;
  const d = await getChallengeDetailForAdmin(id);
  if (!d) notFound();
  const c = d.challenge;
  const canMod = viewer.adminRole === "super" || viewer.adminRole === "moderator";
  return (
    <>
      <PageHeader eyebrow={<Link href="/admin/challenges" className="hover:underline">← Challenge review</Link>} title={c.title} description={c.description ?? undefined} action={<StatusBadge status={c.status} />} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <div className="px-5 pb-5">
              <DL
                items={[
                  { label: "Creator", value: d.creator ? <Link href={`/admin/users/${d.creator.id}`} className="text-brand-600 hover:underline">{d.creator.fullName} · {d.creator.email}</Link> : null },
                  { label: "Category", value: humanize(c.category) },
                  { label: "Level", value: c.level ? humanize(c.level) : null },
                  { label: "Scheduled for", value: formatDate(c.scheduledFor) },
                  { label: "Time limit", value: `${Math.round(c.timeLimitSeconds / 60)} min` },
                  { label: "Max attempts", value: String(c.maxAttempts) },
                  { label: "Attempts", value: `${d.stats.total} started · ${d.stats.submitted} submitted${d.stats.avgScore ? ` · avg score ${d.stats.avgScore}` : ""}` },
                  { label: "Review note", value: c.reviewNote },
                  { label: "Published", value: <When d={c.publishedAt} /> },
                  { label: "Created", value: <When d={c.createdAt} /> },
                ]}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title={`Questions (${d.questions.length})`} description="Correct answers are visible to admins only." />
            <ol className="divide-y divide-ink-100">
              {d.questions.map((q) => (
                <li key={q.id} className="px-5 py-4">
                  <p className="font-medium text-ink-900">
                    {q.position}. {q.prompt} <span className="text-xs text-ink-400">({q.points} pts)</span>
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {q.options.map((o) => (
                      <li key={o.key} className={`flex items-center gap-2 ${o.key === q.correctKey ? "font-semibold text-success-600" : "text-ink-700"}`}>
                        <span className="w-5 text-ink-400">{o.key}.</span>
                        {o.text}
                        {o.key === q.correctKey && <Badge tone="success">Correct</Badge>}
                      </li>
                    ))}
                  </ul>
                  {q.explanation && <p className="mt-2 text-xs text-ink-500">Explanation: {q.explanation}</p>}
                </li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardHeader title="Audit trail" />
            <AuditTrail rows={d.trail} />
          </Card>
        </div>
        <div className="space-y-6">
          {canMod && c.status === "in_review" && (
            <Card>
              <CardHeader title="Review" />
              <div className="px-5 pb-5">
                <ReviewChallengeForm challengeId={c.id} />
              </div>
            </Card>
          )}
          {canMod && c.status !== "archived" && (
            <Card>
              <CardHeader title="Archive" />
              <div className="px-5 pb-5">
                <ArchiveChallengeForm challengeId={c.id} />
              </div>
            </Card>
          )}
          {!canMod && <Alert tone="info">Challenge decisions are made by moderators or super admins.</Alert>}
        </div>
      </div>
    </>
  );
}
