import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cities, states } from "@/db/schema";
import { Alert, Badge, Button, ButtonLink, Card, CardHeader, EmptyState, Field, PageHeader, Select, Stat, cn } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import { ensureOpenCycle, liveStandings, liveSubjectScopes, userStanding, type Scope } from "@/server/leaderboards";
import { countdownLabel } from "./countdown";
import { CycleCountdown } from "./cycle-countdown";
import { StandingsTable } from "./standings-table";

export const metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

const SCOPES: { key: Scope; label: string }[] = [
  { key: "nationwide", label: "Nationwide" },
  { key: "state", label: "My state" },
  { key: "city", label: "My city" },
  { key: "subject", label: "By subject" },
];

export default async function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  const sp = await searchParams;
  const scope: Scope = SCOPES.some((s) => s.key === sp.scope) ? (sp.scope as Scope) : "nationwide";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const user = await getCurrentUser();
  const now = new Date();
  // Idempotent: creates the cycle only when none covers "now" (the cron normally does this).
  const cycle = await ensureOpenCycle();
  const settings = await getSettings(["leaderboard.top_n", "leaderboard.reward_ngn", "leaderboard.min_attempts_for_eligibility"]);
  const subjectsInPlay = await liveSubjectScopes(cycle.id);
  const subjectKey = typeof sp.subject === "string" && /^\d+$/.test(sp.subject) ? sp.subject : subjectsInPlay[0] ? String(subjectsInPlay[0].id) : "";

  let scopeKey = "all";
  let scopeNote: string | null = null;
  let scopeTitle = "Nationwide";
  if (scope === "state") {
    if (!user) scopeNote = "Sign in to see the leaderboard for your state.";
    else if (!user.stateId) scopeNote = "Add your location in account settings to see your state's leaderboard.";
    else {
      scopeKey = String(user.stateId);
      const st = await db.query.states.findFirst({ where: eq(states.id, user.stateId) });
      scopeTitle = st ? `${st.name} State` : "My state";
    }
  } else if (scope === "city") {
    if (!user) scopeNote = "Sign in to see the leaderboard for your city.";
    else if (!user.cityId) scopeNote = "Add your location in account settings to see your city's leaderboard.";
    else {
      scopeKey = String(user.cityId);
      const c = await db.query.cities.findFirst({ where: eq(cities.id, user.cityId) });
      scopeTitle = c ? c.name : "My city";
    }
  } else if (scope === "subject") {
    if (!subjectKey) scopeNote = "No subject-tagged challenges have been submitted in this cycle yet.";
    else {
      scopeKey = subjectKey;
      scopeTitle = subjectsInPlay.find((s) => String(s.id) === subjectKey)?.name ?? "Subject";
    }
  }

  const standings = scopeNote ? null : await liveStandings({ scope, scopeKey, cycleId: cycle.id, limit: 50, page });
  const mine = user && standings ? await userStanding({ scope, scopeKey, cycleId: cycle.id, userId: user.id }) : null;
  const inList = mine && standings?.rows.some((r) => r.userId === mine.userId);
  const hrefFor = (p: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { scope: scope === "nationwide" ? undefined : scope, subject: scope === "subject" ? subjectKey : undefined, page: page > 1 ? String(page) : undefined, ...p };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return `/leaderboard${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Current cycle"
        title="Leaderboard"
        description={
          <>
            {formatDate(cycle.startsAt)} – {formatDate(new Date(cycle.endsAt.getTime() - 1))} · <CycleCountdown endsAt={cycle.endsAt.toISOString()} initialLabel={countdownLabel(cycle.endsAt.getTime() - now.getTime())} />
          </>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/leaderboard/history" variant="outline" size="sm">
              Past cycles
            </ButtonLink>
            <ButtonLink href="/challenges" variant="secondary" size="sm">
              Play today
            </ButtonLink>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Rewards" value={`Top ${settings["leaderboard.top_n"]}`} hint={`₦${Number(settings["leaderboard.reward_ngn"]).toLocaleString()} each (cash or credit)`} tone="brand" />
        <Stat label="Eligibility" value={`${settings["leaderboard.min_attempts_for_eligibility"]}+ attempts`} hint="Submitted attempts in the cycle" />
        <Stat label="Your position" value={mine ? `#${mine.rank}` : user ? "—" : "Sign in"} hint={mine ? `${mine.points} points · ${mine.attemptsCount} attempt${mine.attemptsCount === 1 ? "" : "s"} in ${scopeTitle}` : user ? "No counted attempt in this scope yet" : "to see where you stand"} tone="teal" />
      </div>

      <nav aria-label="Leaderboard scope" className="mb-4 -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {SCOPES.map((s) => (
          <Link key={s.key} href={hrefFor({ scope: s.key, page: undefined })} aria-current={s.key === scope ? "page" : undefined} className={cn("shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors", s.key === scope ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200")}>
            {s.label}
          </Link>
        ))}
      </nav>

      {scope === "subject" && subjectsInPlay.length > 0 && (
        <form method="get" action="/leaderboard" className="mb-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="scope" value="subject" />
          <Field label="Subject" name="subject">
            <Select id="subject" name="subject" defaultValue={subjectKey} className="sm:w-72">
              {subjectsInPlay.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>
      )}

      <Card>
        <CardHeader title={scopeTitle} description={standings ? `${standings.total} student${standings.total === 1 ? "" : "s"} with counted attempts` : undefined} action={<Badge tone="teal">Live</Badge>} />
        <div className="px-5 pb-5">
          {scopeNote ? (
            <Alert tone="info">
              {scopeNote}
              {!user && (
                <>
                  {" "}
                  <Link href={`/login?next=${encodeURIComponent(hrefFor({}))}`} className="font-semibold underline">
                    Sign in
                  </Link>
                </>
              )}
            </Alert>
          ) : standings && standings.rows.length === 0 ? (
            <EmptyState title="No counted attempts yet" description="Submit a challenge to appear here. Attempts finished in under 5 seconds do not count." action={<ButtonLink href="/challenges" size="sm">Play a challenge</ButtonLink>} />
          ) : standings ? (
            <>
              <StandingsTable rows={standings.rows} highlightUserId={user?.id} extra={inList ? null : mine} />
              {!inList && mine && <p className="mt-2 text-xs text-ink-500">Your row is shown below the top {standings.rows.length} because you are ranked #{mine.rank}.</p>}
              {standings.pageCount > 1 && (
                <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
                  <span className="text-ink-500">
                    Page {standings.page} of {standings.pageCount}
                  </span>
                  <div className="flex gap-2">
                    {standings.page > 1 && (
                      <ButtonLink href={hrefFor({ page: String(standings.page - 1) })} variant="outline" size="sm">
                        Previous
                      </ButtonLink>
                    )}
                    {standings.page < standings.pageCount && (
                      <ButtonLink href={hrefFor({ page: String(standings.page + 1) })} variant="outline" size="sm">
                        Next
                      </ButtonLink>
                    )}
                  </div>
                </nav>
              )}
            </>
          ) : null}
        </div>
      </Card>
      <p className="mt-6 text-sm text-ink-500">
        Ranked by points, then correct answers, then shorter total time, then earliest submission. Only your best submitted attempt per challenge counts.{" "}
        <Link href="/how-rewards-work" className="font-semibold text-brand-600 hover:underline">
          How rewards work
        </Link>
      </p>
    </div>
  );
}
