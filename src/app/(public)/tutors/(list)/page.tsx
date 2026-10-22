import Link from "next/link";
import { Avatar, Badge, EmptyState, PageHeader, Pagination, StarRating, buttonClass } from "@/components/ui";
import { formatNgn } from "@/lib/money";
import { listExams, listStates, listSubjects } from "@/server/reference";
import { parseSearchParams, searchTutors, type SearchParams, type TutorSearchResult } from "@/server/search";
import { TutorFilters } from "./filters";

export const metadata = { title: "Find tutors" };
export const dynamic = "force-dynamic";

const PARAM_LABELS: Record<string, string> = {
  subject: "subject",
  level: "level",
  exam: "exam focus",
  format: "format",
  state: "state",
  lga: "LGA",
  city: "city",
  minPrice: "minimum price",
  maxPrice: "maximum price",
  minRating: "minimum rating",
  verified: "verified-only",
  available: "availability day",
};

function toQuery(p: SearchParams, overrides: Partial<Record<string, string | number | undefined>> = {}) {
  const q = new URLSearchParams();
  const entries: Record<string, string | number | undefined> = {
    subject: p.subject,
    level: p.level,
    exam: p.exam,
    format: p.format === "any" ? undefined : p.format,
    state: p.state,
    lga: p.lga,
    city: p.city,
    minPrice: p.minPrice,
    maxPrice: p.maxPrice,
    minRating: p.minRating,
    verified: p.verified ? "1" : undefined,
    available: p.available,
    sort: p.sort === "recommended" ? undefined : p.sort,
    ...overrides,
  };
  for (const [k, v] of Object.entries(entries)) if (v !== undefined && v !== "" && v !== null) q.set(k, String(v));
  const s = q.toString();
  return s ? `/tutors?${s}` : "/tutors";
}

function activeFilterKeys(p: SearchParams) {
  const keys: string[] = [];
  if (p.subject) keys.push("subject");
  if (p.level) keys.push("level");
  if (p.exam) keys.push("exam");
  if (p.format && p.format !== "any") keys.push("format");
  if (p.city) keys.push("city");
  else if (p.lga) keys.push("lga");
  else if (p.state) keys.push("state");
  if (p.minPrice) keys.push("minPrice");
  if (p.maxPrice) keys.push("maxPrice");
  if (p.minRating) keys.push("minRating");
  if (p.verified) keys.push("verified");
  if (p.available !== undefined) keys.push("available");
  return keys;
}

export default async function TutorsPage({ searchParams }: PageProps<"/tutors">) {
  const sp = await searchParams;
  const params = parseSearchParams(sp);
  const [result, states, subjects, exams] = await Promise.all([searchTutors(params), listStates(), listSubjects(), listExams()]);
  const active = activeFilterKeys(params);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Find a tutor"
        description="Verified tutors near you and online. Ranking is based on reviews, reliability and responsiveness; paid placements are always labelled “Promoted”."
      />
      <TutorFilters
        states={states}
        subjects={subjects.map((s) => ({ id: s.id, name: s.name, category: s.category }))}
        exams={exams.map((e) => ({ id: e.id, name: e.name }))}
        values={{ ...params, minRating: params.minRating }}
      />

      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-600" aria-live="polite">
          {result.total === 0 ? "No tutors match" : `${result.total} tutor${result.total === 1 ? "" : "s"} found`}
          {active.length > 0 && <span className="text-ink-400"> · {active.length} filter{active.length === 1 ? "" : "s"} applied</span>}
        </p>
      </div>

      {result.items.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No tutors match these filters"
            description={
              active.length
                ? "Try relaxing one filter at a time. In-person results need a tutor who covers your LGA; online tutors are available anywhere."
                : "No tutors are listed yet. Check back soon, or become a tutor yourself."
            }
            action={
              active.length ? (
                <ul className="flex flex-wrap justify-center gap-2">
                  {active.map((k) => {
                    const overrides: Record<string, undefined> = { [k]: undefined };
                    if (k === "lga") Object.assign(overrides, { city: undefined });
                    if (k === "state") Object.assign(overrides, { lga: undefined, city: undefined });
                    return (
                      <li key={k}>
                        <Link href={toQuery(params, overrides)} className={buttonClass("outline", "sm")}>
                          Remove {PARAM_LABELS[k] ?? k} filter
                        </Link>
                      </li>
                    );
                  })}
                  {params.format === "physical" && (
                    <li>
                      <Link href={toQuery(params, { format: "online" })} className={buttonClass("secondary", "sm")}>
                        Show online tutors instead
                      </Link>
                    </li>
                  )}
                </ul>
              ) : (
                <Link href="/register?as=tutor" className={buttonClass("primary", "sm")}>
                  Become a tutor
                </Link>
              )
            }
          />
        </div>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Tutors">
          {result.items.map((t) => (
            <li key={t.id}>
              <TutorCard t={t} />
            </li>
          ))}
        </ul>
      )}

      <Pagination page={result.page} pageCount={result.pageCount} hrefFor={(p) => toQuery(params, { page: p > 1 ? p : undefined })} />
    </div>
  );
}

function TutorCard({ t }: { t: TutorSearchResult }) {
  const formats = [t.offersPhysical && "In person", t.offersOnline && "Online"].filter(Boolean).join(" · ");
  return (
    <article className="tl-card flex h-full flex-col p-5">
      <div className="flex items-start gap-3">
        <Avatar name={t.name} src={t.avatarUrl} size={52} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-ink-900">
            <Link href={`/tutors/${t.id}`} className="hover:text-brand-600">
              {t.name}
            </Link>
          </h2>
          {t.headline && <p className="mt-0.5 line-clamp-2 text-sm text-ink-600">{t.headline}</p>}
          <div className="mt-1.5">
            <StarRating value={t.ratingAvg} count={t.ratingCount} />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {t.identityVerified && <Badge tone="success">Identity verified</Badge>}
        {t.qualificationsVerified && <Badge tone="teal">Qualifications verified</Badge>}
        {t.promoted && (
          <Badge tone="warning" className="normal-case">
            Promoted
          </Badge>
        )}
      </div>
      <dl className="mt-3 space-y-1.5 text-sm text-ink-600">
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-ink-400">Formats</dt>
          <dd>{formats || "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-ink-400">Subjects</dt>
          <dd>
            {t.subjects.map((s) => s.name).join(", ") || "—"}
            {t.subjectCount > 3 && <span className="text-ink-400"> +{t.subjectCount - 3} more</span>}
          </dd>
        </div>
        {t.offersPhysical && (
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-400">Areas</dt>
            <dd>
              {t.areas.join("; ") || "No areas listed"}
              {t.areaCount > 2 && <span className="text-ink-400"> +{t.areaCount - 2} more</span>}
            </dd>
          </div>
        )}
      </dl>
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <p className="text-sm text-ink-600">
          {t.minPrice ? (
            <>
              from <span className="text-base font-bold text-ink-900">{formatNgn(t.minPrice)}</span>
            </>
          ) : (
            "No published packages"
          )}
        </p>
        <Link href={`/tutors/${t.id}`} className={buttonClass("primary", "sm")}>
          View profile
        </Link>
      </div>
    </article>
  );
}
