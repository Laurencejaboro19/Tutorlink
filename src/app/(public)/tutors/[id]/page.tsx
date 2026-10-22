import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cities, exams, lgas, packages, reviews, states, subjects, tutorAvailability, tutorExams, tutorProfiles, tutorQualifications, tutorServiceAreas, tutorSubjects, users } from "@/db/schema";
import { Avatar, Badge, Card, CardHeader, EmptyState, Pagination, StarRating, buttonClass, type Tone } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { formatDate, minutesToLabel } from "@/lib/time";
import { levelLabel } from "@/server/reference";

export const dynamic = "force-dynamic";

const REVIEW_PAGE = 10;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const verificationLabel: Record<string, { label: string; tone: Tone }> = {
  not_submitted: { label: "Not submitted", tone: "neutral" },
  pending: { label: "Under review", tone: "warning" },
  verified: { label: "Verified", tone: "success" },
  rejected: { label: "Not verified", tone: "danger" },
  needs_info: { label: "More info requested", tone: "warning" },
};

function formatLabel(f: string) {
  return f === "physical" ? "In person" : f === "online" ? "Online" : "In person or online";
}

export async function generateMetadata({ params }: PageProps<"/tutors/[id]">) {
  const { id } = await params;
  const row = await db
    .select({ name: users.displayName, full: users.fullName, headline: tutorProfiles.headline })
    .from(tutorProfiles)
    .innerJoin(users, eq(users.id, tutorProfiles.userId))
    .where(and(eq(tutorProfiles.userId, id), eq(tutorProfiles.isListed, true)))
    .limit(1);
  const r = row[0];
  if (!r) notFound();
  return { title: `${r.name ?? r.full.split(" ")[0]} — ${r.headline ?? "Tutor"}` };
}

export default async function TutorProfilePage({ params, searchParams }: PageProps<"/tutors/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [row] = await db
    .select({ profile: tutorProfiles, name: users.displayName, fullName: users.fullName, avatarUrl: users.avatarUrl, status: users.status, deletedAt: users.deletedAt, stateId: users.stateId })
    .from(tutorProfiles)
    .innerJoin(users, eq(users.id, tutorProfiles.userId))
    .where(eq(tutorProfiles.userId, id))
    .limit(1);
  if (!row || !row.profile.isListed || row.status !== "active" || row.deletedAt) notFound();
  const { profile } = row;
  const name = row.name ?? row.fullName.split(" ")[0];
  const reviewPage = Math.max(1, Number(typeof sp.rp === "string" && /^\d+$/.test(sp.rp) ? sp.rp : 1));

  const [viewer, subjectRows, examRows, quals, areas, windows, pkgs, reviewRows, [{ n: reviewTotal }], homeState] = await Promise.all([
    getCurrentUser(),
    db.select({ id: subjects.id, name: subjects.name, levels: tutorSubjects.levels }).from(tutorSubjects).innerJoin(subjects, eq(subjects.id, tutorSubjects.subjectId)).where(eq(tutorSubjects.tutorId, id)).orderBy(asc(subjects.name)),
    db.select({ id: exams.id, name: exams.name }).from(tutorExams).innerJoin(exams, eq(exams.id, tutorExams.examId)).where(eq(tutorExams.tutorId, id)).orderBy(asc(exams.id)),
    db.select({ id: tutorQualifications.id, title: tutorQualifications.title, institution: tutorQualifications.institution, year: tutorQualifications.yearObtained, status: tutorQualifications.status }).from(tutorQualifications).where(eq(tutorQualifications.tutorId, id)).orderBy(desc(tutorQualifications.yearObtained)),
    db
      .select({ id: tutorServiceAreas.id, state: states.name, lga: lgas.name, city: cities.name })
      .from(tutorServiceAreas)
      .innerJoin(lgas, eq(lgas.id, tutorServiceAreas.lgaId))
      .innerJoin(states, eq(states.id, tutorServiceAreas.stateId))
      .leftJoin(cities, eq(cities.id, tutorServiceAreas.cityId))
      .where(eq(tutorServiceAreas.tutorId, id))
      .orderBy(asc(states.name), asc(lgas.name)),
    db.select().from(tutorAvailability).where(eq(tutorAvailability.tutorId, id)).orderBy(asc(tutorAvailability.weekday), asc(tutorAvailability.startMinute)),
    db
      .select({ pkg: packages, subject: subjects.name, exam: exams.name })
      .from(packages)
      .innerJoin(subjects, eq(subjects.id, packages.subjectId))
      .leftJoin(exams, eq(exams.id, packages.examId))
      .where(and(eq(packages.tutorId, id), eq(packages.status, "published")))
      .orderBy(asc(packages.priceNgn)),
    db
      .select({ id: reviews.id, rating: reviews.rating, comment: reviews.comment, createdAt: reviews.createdAt, student: users.displayName, studentFull: users.fullName })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.studentId))
      .where(and(eq(reviews.tutorId, id), eq(reviews.status, "published")))
      .orderBy(desc(reviews.createdAt))
      .limit(REVIEW_PAGE)
      .offset((reviewPage - 1) * REVIEW_PAGE),
    db.select({ n: count() }).from(reviews).where(and(eq(reviews.tutorId, id), eq(reviews.status, "published"))),
    row.stateId ? db.query.states.findFirst({ where: eq(states.id, row.stateId) }) : Promise.resolve(null),
  ]);

  const reviewPageCount = Math.max(1, Math.ceil(reviewTotal / REVIEW_PAGE));
  const formats = [profile.offersPhysical && "In person", profile.offersOnline && "Online"].filter(Boolean) as string[];
  const identity = verificationLabel[profile.identityStatus];
  const qualification = verificationLabel[profile.qualificationStatus];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <nav className="mb-4 text-sm text-ink-500" aria-label="Breadcrumb">
        <Link href="/tutors" className="hover:text-brand-600">
          Find tutors
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-ink-700">{name}</span>
      </nav>

      <header className="tl-card flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:p-6">
        <Avatar name={name} src={row.avatarUrl} size={88} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-ink-900">{name}</h1>
          {profile.headline && <p className="mt-1 text-[15px] text-ink-700">{profile.headline}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-600">
            <StarRating value={Number(profile.ratingAvg)} count={profile.ratingCount} size={16} />
            <span>{profile.completedSessions} session{profile.completedSessions === 1 ? "" : "s"} completed</span>
            {profile.yearsExperience > 0 && <span>{profile.yearsExperience} yr{profile.yearsExperience === 1 ? "" : "s"} experience</span>}
            {homeState && <span>Based in {homeState.name}</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone={identity.tone}>Identity: {identity.label}</Badge>
            <Badge tone={qualification.tone}>Qualifications: {qualification.label}</Badge>
            {formats.map((f) => (
              <Badge key={f} tone="brand">
                {f}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <a href="#packages" className={buttonClass("primary", "md")}>
            Book a session
          </a>
          <Link href={`/report?type=user&id=${id}`} className="text-center text-xs text-ink-500 hover:text-danger-600 hover:underline">
            Report this profile
          </Link>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="About" />
            <div className="px-5 pb-5 text-[15px] leading-relaxed text-ink-700 whitespace-pre-line">{profile.bio || "This tutor has not written a bio yet."}</div>
          </Card>

          <Card>
            <CardHeader title="Subjects & levels" />
            <div className="px-5 pb-5">
              {subjectRows.length === 0 ? (
                <p className="text-sm text-ink-500">No subjects listed.</p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {subjectRows.map((s) => (
                    <li key={s.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <span className="font-medium text-ink-900">{s.name}</span>
                      <span className="text-sm text-ink-500">{s.levels.map(levelLabel).join(", ") || "All levels"}</span>
                    </li>
                  ))}
                </ul>
              )}
              {examRows.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Exam preparation</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {examRows.map((e) => (
                      <Badge key={e.id} tone="teal">
                        {e.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card id="packages">
            <CardHeader title="Packages" description="Prices are per package; what you pay is what you see. Platform commission is handled on the tutor side." />
            <div className="px-5 pb-5">
              {pkgs.length === 0 ? (
                <EmptyState title="No packages published" description="This tutor has not published a bookable package yet." />
              ) : (
                <ul className="grid gap-4 md:grid-cols-2">
                  {pkgs.map(({ pkg, subject, exam }) => (
                    <li key={pkg.id} className="flex flex-col rounded-[var(--radius-md)] border border-ink-200 p-4">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone="brand">{subject}</Badge>
                        <Badge>{levelLabel(pkg.level)}</Badge>
                        {exam && <Badge tone="teal">{exam}</Badge>}
                        <Badge tone="neutral">{formatLabel(pkg.format)}</Badge>
                      </div>
                      <h3 className="mt-2 text-base font-semibold text-ink-900">{pkg.title}</h3>
                      <p className="mt-1 line-clamp-3 text-sm text-ink-600">{pkg.description}</p>
                      {pkg.outcomes.length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm text-ink-600">
                          {pkg.outcomes.slice(0, 4).map((o, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-teal-500" aria-hidden="true">
                                ✓
                              </span>
                              {o}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-2 text-xs text-ink-500">
                        {pkg.sessionsCount} session{pkg.sessionsCount === 1 ? "" : "s"} · {pkg.durationMinutes} min each
                      </p>
                      <div className="mt-auto flex items-center justify-between pt-4">
                        <span className="text-lg font-bold text-ink-900">{formatNgn(pkg.priceNgn)}</span>
                        <Link href={`/book/${pkg.id}`} className={buttonClass("primary", "sm")}>
                          Book
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card id="reviews">
            <CardHeader title={`Reviews (${reviewTotal})`} description="Only students who completed a paid session can review." />
            <div className="px-5 pb-5">
              {reviewRows.length === 0 ? (
                <p className="text-sm text-ink-500">No reviews yet.</p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {reviewRows.map((r) => (
                    <li key={r.id} className="py-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-ink-900">{r.student ?? r.studentFull.split(" ")[0]}</span>
                        <time className="text-xs text-ink-400" dateTime={r.createdAt.toISOString()}>
                          {formatDate(r.createdAt)}
                        </time>
                      </div>
                      <div className="mt-1">
                        <StarRating value={r.rating} />
                      </div>
                      {r.comment && <p className="mt-2 text-sm text-ink-700">{r.comment}</p>}
                    </li>
                  ))}
                </ul>
              )}
              <Pagination page={reviewPage} pageCount={reviewPageCount} hrefFor={(p) => `/tutors/${id}?rp=${p}#reviews`} />
            </div>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Qualifications" />
            <div className="px-5 pb-5">
              {quals.length === 0 ? (
                <p className="text-sm text-ink-500">No qualifications added.</p>
              ) : (
                <ul className="space-y-3">
                  {quals.map((q) => {
                    const v = verificationLabel[q.status];
                    return (
                      <li key={q.id} className="text-sm">
                        <p className="font-medium text-ink-900">{q.title}</p>
                        <p className="text-ink-600">
                          {q.institution}
                          {q.year ? ` · ${q.year}` : ""}
                        </p>
                        <Badge tone={v.tone} className="mt-1">
                          {v.label}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Where & how" />
            <div className="px-5 pb-5 text-sm">
              <p className="font-medium text-ink-900">Formats</p>
              <p className="text-ink-600">{formats.join(" and ") || "Not set"}</p>
              {profile.offersPhysical && (
                <>
                  <p className="mt-3 font-medium text-ink-900">In-person service areas</p>
                  {areas.length === 0 ? (
                    <p className="text-ink-600">No areas listed yet.</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-ink-600">
                      {areas.map((a) => (
                        <li key={a.id}>
                          {a.city ? `${a.city}, ` : ""}
                          {a.lga} LGA, {a.state}
                          {!a.city && <span className="text-ink-400"> (whole LGA)</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Weekly availability" description="Times are West Africa Time (Lagos)." />
            <div className="px-5 pb-5">
              {windows.length === 0 ? (
                <p className="text-sm text-ink-500">No availability set.</p>
              ) : (
                <table className="w-full text-sm">
                  <caption className="sr-only">Weekly availability windows</caption>
                  <tbody>
                    {WEEKDAYS.map((d, i) => {
                      const w = windows.filter((x) => x.weekday === i);
                      return (
                        <tr key={d} className="border-b border-ink-100 last:border-0">
                          <th scope="row" className="w-12 py-2 text-left font-medium text-ink-700">
                            {d}
                          </th>
                          <td className="py-2 text-ink-600">
                            {w.length === 0 ? (
                              <span className="text-ink-300">—</span>
                            ) : (
                              <ul className="space-y-0.5">
                                {w.map((x) => (
                                  <li key={x.id}>
                                    {minutesToLabel(x.startMinute)}–{minutesToLabel(x.endMinute)}
                                    {x.format !== "hybrid" && <span className="text-ink-400"> ({formatLabel(x.format).toLowerCase()})</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
          {viewer?.id === id && (
            <p className="text-xs text-ink-500">
              This is how students see you.{" "}
              <Link href="/tutor/profile" className="font-semibold text-brand-600 hover:underline">
                Edit profile
              </Link>
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
