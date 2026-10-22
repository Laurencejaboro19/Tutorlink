import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getTutorDetail } from "@/server/admin";
import { humanize } from "../../_components/labels";
import { AuditTrail, DL, StatusBadge, When } from "../../_components/table";
import { ForceUnlistForm, IdentityReviewForm, QualificationReviewForm } from "./tutor-actions";

export const dynamic = "force-dynamic";

export default async function AdminTutorDetailPage({ params }: PageProps<"/admin/tutors/[id]">) {
  const viewer = await requireAdmin();
  const { id } = await params;
  const d = await getTutorDetail(id);
  if (!d) notFound();
  const canReview = viewer.adminRole === "super" || viewer.adminRole === "moderator";
  const { profile: p, user: u } = d;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/tutors" className="hover:underline">← Tutor verification</Link>}
        title={u.fullName}
        description={
          <>
            {u.email} · <Link href={`/admin/users/${u.id}`} className="text-brand-600 hover:underline">user record</Link>
          </>
        }
        action={
          <div className="flex flex-wrap gap-1">
            <StatusBadge status={u.status} />
            {p.isListed ? <Badge tone="success">Listed</Badge> : <Badge tone="neutral">Not listed</Badge>}
          </div>
        }
      />
      {!canReview && <Alert tone="info" className="mb-4">Finance admins can view verification status but decisions are made by moderators or super admins. Identity document references are hidden.</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Profile" />
            <div className="px-5 pb-5">
              <DL
                items={[
                  { label: "Headline", value: p.headline },
                  { label: "Experience", value: `${p.yearsExperience} year${p.yearsExperience === 1 ? "" : "s"}` },
                  { label: "Formats", value: [p.offersOnline && "Online", p.offersPhysical && "In person"].filter(Boolean).join(", ") || "None" },
                  { label: "Packages", value: `${d.packages.published} published / ${d.packages.total} total` },
                  { label: "Rank score", value: p.rankScore },
                  { label: "Rating", value: `${Number(p.ratingAvg).toFixed(1)} (${p.ratingCount} reviews)` },
                  { label: "Completed sessions", value: String(p.completedSessions) },
                  { label: "Cancelled by tutor", value: String(p.cancelledByTutor) },
                  { label: "Profile created", value: <When d={p.createdAt} /> },
                ]}
              />
              {p.bio && <p className="mt-4 whitespace-pre-wrap text-sm text-ink-700">{p.bio}</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Identity verification" action={<StatusBadge status={p.identityStatus} />} />
            <div className="px-5 pb-5">
              <DL
                items={[
                  { label: "Document type", value: canReview ? p.identityDocumentType : "Hidden" },
                  { label: "Document reference", value: canReview ? (p.identityDocumentRef ? <code className="break-all text-xs">{p.identityDocumentRef}</code> : null) : "Hidden" },
                  { label: "Last review note", value: p.identityReviewNote },
                ]}
              />
              {canReview && p.identityStatus !== "not_submitted" && (
                <div className="mt-5 border-t border-ink-100 pt-5">
                  <IdentityReviewForm tutorId={u.id} current={p.identityStatus} />
                </div>
              )}
              {p.identityStatus === "not_submitted" && <p className="mt-4 text-sm text-ink-500">The tutor has not uploaded an identity document yet.</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Qualifications" description="Overall status is verified when at least one is verified, rejected when all are rejected, otherwise pending." action={<StatusBadge status={p.qualificationStatus} />} />
            {d.qualifications.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-ink-500">No qualifications submitted.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {d.qualifications.map((q) => (
                  <li key={q.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-ink-900">{q.title}</p>
                        <p className="text-sm text-ink-600">
                          {q.institution}
                          {q.yearObtained ? ` · ${q.yearObtained}` : ""}
                        </p>
                        {canReview && q.documentRef && <p className="mt-1 break-all text-xs text-ink-500">Document: {q.documentRef}</p>}
                        {q.reviewNote && <p className="mt-1 text-xs text-ink-500">Note: {q.reviewNote}</p>}
                      </div>
                      <StatusBadge status={q.status} />
                    </div>
                    {canReview && (
                      <div className="mt-3">
                        <QualificationReviewForm qualificationId={q.id} current={q.status} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Audit trail" />
            <AuditTrail rows={d.trail} />
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Listing" description={p.isListed ? "Visible in search." : `Not visible. Identity: ${humanize(p.identityStatus).toLowerCase()}.`} />
            <div className="px-5 pb-5">{canReview && p.isListed ? <ForceUnlistForm tutorId={u.id} /> : <p className="text-sm text-ink-500">{p.isListed ? "Only moderators can unlist." : "Tutors relist themselves from their profile page once verification passes."}</p>}</div>
          </Card>
        </div>
      </div>
    </>
  );
}
