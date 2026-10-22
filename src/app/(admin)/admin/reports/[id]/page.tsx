import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getReportDetail } from "@/server/admin";
import { humanize } from "../../_components/labels";
import { AuditTrail, DL, StatusBadge, When } from "../../_components/table";
import { QuickArchiveChallenge, QuickHideReview, QuickSuspend, ReportStatusForm } from "../report-actions";

export const dynamic = "force-dynamic";

export default async function AdminReportDetailPage({ params }: PageProps<"/admin/reports/[id]">) {
  const viewer = await requireAdmin();
  const { id } = await params;
  const d = await getReportDetail(id);
  if (!d) notFound();
  const r = d.report;
  const t = d.target;
  const canMod = viewer.adminRole === "super" || viewer.adminRole === "moderator";
  const reasonText = `Report ${r.id.slice(0, 8)}: ${humanize(r.reason)}${r.details ? ` — ${r.details.slice(0, 200)}` : ""}`;
  const closed = r.status === "resolved" || r.status === "dismissed";
  return (
    <>
      <PageHeader eyebrow={<Link href="/admin/reports" className="hover:underline">← Reports</Link>} title={`${humanize(r.reason)} · ${humanize(r.targetType)}`} description={`Reported ${r.createdAt.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}`} action={<StatusBadge status={r.status} />} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Report" />
            <div className="px-5 pb-5">
              <DL
                items={[
                  { label: "Reporter", value: d.reporter ? <Link href={`/admin/users/${d.reporter.id}`} className="text-brand-600 hover:underline">{d.reporter.fullName} · {d.reporter.email}</Link> : null },
                  { label: "Target", value: t.href ? <Link href={t.href} className="text-brand-600 hover:underline">{t.label}</Link> : t.label },
                  { label: "Reason", value: humanize(r.reason) },
                  { label: "Handled by", value: d.handler?.email ?? null },
                  { label: "Updated", value: <When d={r.updatedAt} /> },
                  { label: "Resolution note", value: r.resolutionNote },
                ]}
              />
              <div className="mt-4 rounded-[var(--radius-md)] bg-ink-50 p-4 text-sm text-ink-700 whitespace-pre-wrap">{r.details || "No details provided."}</div>
            </div>
          </Card>
          {t.type === "review" && (
            <Card>
              <CardHeader title="Reported review" action={<StatusBadge status={t.review.status} />} />
              <p className="px-5 pb-5 text-sm text-ink-700">
                {t.review.rating}★ {t.review.comment ?? <span className="text-ink-400">(no comment)</span>}
              </p>
            </Card>
          )}
          <Card>
            <CardHeader title="Audit trail" />
            <AuditTrail rows={d.trail} />
          </Card>
        </div>
        <div className="space-y-6">
          {canMod ? (
            <>
              <Card>
                <CardHeader title="Update status" />
                <div className="px-5 pb-5">
                  <ReportStatusForm reportId={r.id} current={r.status} />
                </div>
              </Card>
              {!closed && (
                <Card>
                  <CardHeader title="Quick actions" description="Each one is audited and confirmed." />
                  <div className="space-y-6 px-5 pb-5">
                    {t.type === "user" && t.user.status !== "suspended" && t.user.id !== viewer.id && <QuickSuspend userId={t.user.id} reason={reasonText} />}
                    {t.type === "user" && t.user.status === "suspended" && <Alert tone="info">This user is already suspended.</Alert>}
                    {t.type === "booking" && (
                      <div className="flex flex-col gap-3 text-sm">
                        <Link href={`/admin/users/${t.booking.studentId}`} className="text-brand-600 hover:underline">
                          Open student →
                        </Link>
                        <Link href={`/admin/users/${t.booking.tutorId}`} className="text-brand-600 hover:underline">
                          Open tutor →
                        </Link>
                        <Link href={`/admin/bookings/${t.booking.id}`} className="text-brand-600 hover:underline">
                          Open booking (resolve / cancel) →
                        </Link>
                      </div>
                    )}
                    {t.type === "review" && t.review.status !== "hidden" && <QuickHideReview reviewId={t.review.id} reason={reasonText} />}
                    {t.type === "review" && t.review.status === "hidden" && <Alert tone="info">This review is already hidden.</Alert>}
                    {t.type === "challenge" && t.challenge.status !== "archived" && <QuickArchiveChallenge challengeId={t.challenge.id} reason={reasonText} />}
                    {t.type === "challenge" && t.challenge.status === "archived" && <Alert tone="info">This challenge is already archived.</Alert>}
                    {t.type === "missing" && <Alert tone="warning">{t.label}</Alert>}
                  </div>
                </Card>
              )}
            </>
          ) : (
            <Alert tone="info">Reports are handled by moderators or super admins.</Alert>
          )}
        </div>
      </div>
    </>
  );
}
