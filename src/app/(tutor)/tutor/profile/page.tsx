import Link from "next/link";
import { Alert, Badge, Card, CardHeader, PageHeader, buttonClass } from "@/components/ui";
import { requireTutor } from "@/lib/auth";
import { listExams, listSubjects } from "@/server/reference";
import { getTutorProfile, IDENTITY_DOCUMENT_TYPES, listingRequirements, VERIFICATION } from "@/server/tutor-profile";
import { IdentityForm, ListingToggle, ProfileForm, QualificationForm, RemoveQualificationButton } from "./profile-forms";

export const metadata = { title: "Profile & verification" };
export const dynamic = "force-dynamic";

export default async function TutorProfilePage() {
  const user = await requireTutor();
  const [{ profile, subjects: mySubjects, examIds, qualifications }, listing, subjects, exams] = await Promise.all([getTutorProfile(user.id), listingRequirements(user.id), listSubjects(), listExams()]);
  const identity = VERIFICATION[profile?.identityStatus ?? "not_submitted"];
  const qualification = VERIFICATION[profile?.qualificationStatus ?? "not_submitted"];
  const levels = Array.from(new Set(mySubjects.flatMap((s) => s.levels)));
  const docType = IDENTITY_DOCUMENT_TYPES.find((d) => d.value === profile?.identityDocumentType)?.label;

  return (
    <>
      <PageHeader
        title="Profile & verification"
        description="What students see, plus the checks that unlock your listing."
        action={
          profile?.isListed ? (
            <Link href={`/tutors/${user.id}`} className={buttonClass("outline", "sm")}>
              View public profile
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-6">
        <Card id="listing">
          <CardHeader
            title="Listing"
            description="Your profile appears in search only when it is listed."
            action={profile?.isListed ? <Badge tone="success">Listed</Badge> : <Badge tone="neutral">Not listed</Badge>}
          />
          <div className="px-5 pb-5">
            <ul className="space-y-2">
              {listing.requirements.map((r) => (
                <li key={r.key} className="flex items-start gap-3 text-sm">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${r.met ? "bg-teal-500 text-white" : "bg-ink-100 text-ink-500"}`} aria-hidden="true">
                    {r.met ? "✓" : "–"}
                  </span>
                  <span>
                    <span className={r.met ? "font-medium text-ink-900" : "font-medium text-ink-700"}>
                      {r.label} <span className="sr-only">{r.met ? "(met)" : "(not met)"}</span>
                    </span>
                    {!r.met && (
                      <span className="block text-ink-500">
                        {r.hint}{" "}
                        <Link href={r.href} className="font-semibold text-brand-600 hover:underline">
                          Fix this
                        </Link>
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              {listing.allMet || profile?.isListed ? (
                <ListingToggle listed={!!profile?.isListed} canList={listing.allMet} />
              ) : (
                <p className="text-sm text-ink-500">Complete the requirements above to list your profile.</p>
              )}
            </div>
          </div>
        </Card>

        <Card id="identity">
          <CardHeader title="Identity verification" description="Required before you can be listed. Reviewed by our team, usually within 2 working days." action={<Badge tone={identity.tone}>{identity.label}</Badge>} />
          <div className="px-5 pb-5">
            {profile?.identityReviewNote && (profile.identityStatus === "rejected" || profile.identityStatus === "needs_info") && (
              <Alert tone="warning" title="Note from the review team" className="mb-4">
                {profile.identityReviewNote}
              </Alert>
            )}
            {profile?.identityStatus === "verified" ? (
              <p className="text-sm text-ink-700">Your identity is verified{docType ? ` (${docType})` : ""}. Thank you.</p>
            ) : profile?.identityStatus === "pending" ? (
              <p className="text-sm text-ink-700">Your {docType ?? "document"} details were submitted and are awaiting review. We will notify you when it is checked.</p>
            ) : (
              <IdentityForm types={[...IDENTITY_DOCUMENT_TYPES]} />
            )}
          </div>
        </Card>

        <Card id="profile">
          <CardHeader title="Public profile" description="Headline, bio, formats, subjects and exams." />
          <div className="px-5 pb-5">
            <ProfileForm
              values={{
                headline: profile?.headline ?? null,
                bio: profile?.bio ?? null,
                yearsExperience: profile?.yearsExperience ?? 0,
                offersPhysical: !!profile?.offersPhysical,
                offersOnline: profile?.offersOnline ?? true,
                subjectIds: mySubjects.map((s) => s.id),
                levels,
                examIds,
              }}
              subjects={subjects.map((s) => ({ id: s.id, name: s.name, category: s.category }))}
              exams={exams.map((e) => ({ id: e.id, name: e.name }))}
            />
          </div>
        </Card>

        <Card id="qualifications">
          <CardHeader title="Qualifications" description="Degrees, teaching certificates and licences. Verified qualifications earn a badge and improve ranking." action={<Badge tone={qualification.tone}>{qualification.label}</Badge>} />
          <div className="px-5 pb-5">
            {profile?.qualificationReviewNote && (
              <Alert tone="info" title="Note from the review team" className="mb-4">
                {profile.qualificationReviewNote}
              </Alert>
            )}
            {qualifications.length > 0 && (
              <ul className="mb-5 divide-y divide-ink-100">
                {qualifications.map((q) => {
                  const v = VERIFICATION[q.status];
                  return (
                    <li key={q.id} className="flex items-start justify-between gap-3 py-3">
                      <div className="text-sm">
                        <p className="font-medium text-ink-900">{q.title}</p>
                        <p className="text-ink-600">
                          {q.institution}
                          {q.yearObtained ? ` · ${q.yearObtained}` : ""}
                        </p>
                        {q.documentRef && <p className="text-xs text-ink-500">Document: {q.documentRef}</p>}
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Badge tone={v.tone}>{v.label}</Badge>
                          {q.reviewNote && <span className="text-xs text-ink-500">{q.reviewNote}</span>}
                        </div>
                      </div>
                      <RemoveQualificationButton id={q.id} />
                    </li>
                  );
                })}
              </ul>
            )}
            <QualificationForm />
          </div>
        </Card>
      </div>
    </>
  );
}
