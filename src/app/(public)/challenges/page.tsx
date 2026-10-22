import Link from "next/link";
import { Alert, Badge, Button, ButtonLink, EmptyState, Field, PageHeader, Select, Stat } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { addDays, formatDate, platformDay, platformDayStart } from "@/lib/time";
import { categoriesForDay, listPublishedForDay, userBestScores, userStreak, type ChallengeCard } from "@/server/challenges";
import { LEVELS, levelLabel, listSubjects } from "@/server/reference";
import { minutesLabel } from "./format";

export const metadata = { title: "Daily challenges" };
export const dynamic = "force-dynamic";

export default async function ChallengesPage({ searchParams }: PageProps<"/challenges">) {
  const sp = await searchParams;
  const today = platformDay();
  const yesterday = platformDay(addDays(platformDayStart(today), -1));
  const dayParam = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : today;
  const day = dayParam > today ? today : dayParam; // no peeking at future days
  const isToday = day === today;
  const category = typeof sp.category === "string" ? sp.category : "";
  const level = typeof sp.level === "string" ? sp.level : "";
  const subjectId = typeof sp.subject === "string" && /^\d+$/.test(sp.subject) ? Number(sp.subject) : undefined;

  const user = await getCurrentUser();
  const [cards, categories, subjects] = await Promise.all([listPublishedForDay(day, { category: category || undefined, level: level || undefined, subjectId }), categoriesForDay(day), listSubjects()]);
  const [scores, streak] = user ? await Promise.all([userBestScores(user.id, cards.map((c) => c.id)), userStreak(user.id)]) : [new Map(), 0];

  const grouped = new Map<string, ChallengeCard[]>();
  for (const c of cards) grouped.set(c.category, [...(grouped.get(c.category) ?? []), c]);
  const hrefFor = (overrides: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { day: isToday ? undefined : day, category, level, subject: subjectId ? String(subjectId) : "", ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return `/challenges${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow={isToday ? "Today" : formatDate(day)}
        title={isToday ? "Daily challenges" : `Challenges for ${formatDate(day)}`}
        description={isToday ? "New quizzes every day, set by tutors and reviewed by TutorLink. Answers are checked on our servers and only your best attempt per challenge counts for the leaderboard." : "This day has closed. Scores shown are your best submitted attempts."}
        action={
          <div className="flex flex-wrap gap-2">
            {isToday ? (
              <ButtonLink href={hrefFor({ day: yesterday })} variant="outline" size="sm">
                Yesterday&apos;s results
              </ButtonLink>
            ) : (
              <ButtonLink href={hrefFor({ day: undefined })} variant="outline" size="sm">
                Back to today
              </ButtonLink>
            )}
            <ButtonLink href="/leaderboard" variant="secondary" size="sm">
              Leaderboard
            </ButtonLink>
          </div>
        }
      />

      {user ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Stat label="Your streak" value={`${streak} day${streak === 1 ? "" : "s"}`} hint={streak > 0 ? "Consecutive days with a submitted attempt" : "Submit any challenge today to start a streak"} tone="teal" />
          <Stat label="Challenges today" value={cards.length} hint={`${grouped.size} categor${grouped.size === 1 ? "y" : "ies"}`} />
          <Stat label="Attempted" value={[...scores.values()].filter((s) => s.attempts > 0).length} hint="On this day" />
        </div>
      ) : (
        <Alert tone="brand" className="mb-6" title="Sign in to play">
          Challenges are free. Sign in to start an attempt, keep a streak and climb the leaderboard.{" "}
          <Link href="/login?next=/challenges" className="font-semibold underline">
            Sign in
          </Link>{" "}
          or{" "}
          <Link href="/register" className="font-semibold underline">
            create an account
          </Link>
          .
        </Alert>
      )}

      <form method="get" action="/challenges" className="tl-card mb-6 grid gap-3 p-4 sm:grid-cols-4 sm:items-end">
        {!isToday && <input type="hidden" name="day" value={day} />}
        <Field label="Category" name="category">
          <Select id="category" name="category" defaultValue={category}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Level" name="level">
          <Select id="level" name="level" defaultValue={level}>
            <option value="">All levels</option>
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Subject" name="subject">
          <Select id="subject" name="subject" defaultValue={subjectId ? String(subjectId) : ""}>
            <option value="">All subjects</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="outline" className="flex-1">
            Apply filters
          </Button>
          {(category || level || subjectId) && (
            <ButtonLink href={hrefFor({ category: "", level: "", subject: "" })} variant="ghost">
              Clear
            </ButtonLink>
          )}
        </div>
      </form>

      {cards.length === 0 ? (
        <EmptyState
          title={isToday ? "No challenges published yet today" : "No challenges on this day"}
          description={isToday ? "Tutors schedule challenges a day ahead and TutorLink reviews them. Check back later or try clearing the filters." : "Try another day or clear the filters."}
          action={
            user?.isTutor ? (
              <ButtonLink href="/tutor/challenges/new" variant="secondary">
                Create a challenge
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-8">
          {[...grouped.entries()].map(([cat, list]) => (
            <section key={cat} aria-labelledby={`cat-${cat}`}>
              <h2 id={`cat-${cat}`} className="mb-3 text-lg font-semibold text-ink-900">
                {cat} <span className="text-sm font-normal text-ink-400">({list.length})</span>
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((c) => {
                  const mine = scores.get(c.id);
                  const done = mine && mine.attempts > 0 && !mine.inProgressId;
                  const isCreator = user?.id === c.creatorId;
                  return (
                    <li key={c.id} className="tl-card flex flex-col p-5">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-base font-semibold text-ink-900">
                          <Link href={`/challenges/${c.id}`} className="hover:text-brand-600">
                            {c.title}
                          </Link>
                        </h3>
                        <Badge tone="brand">{c.totalPoints} pts</Badge>
                      </div>
                      <p className="mt-1 text-sm text-ink-500">by {c.creatorName}</p>
                      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
                        {c.subjectName && (
                          <div>
                            <dt className="sr-only">Subject</dt>
                            <dd>{c.subjectName}</dd>
                          </div>
                        )}
                        {c.level && (
                          <div>
                            <dt className="sr-only">Level</dt>
                            <dd>{levelLabel(c.level)}</dd>
                          </div>
                        )}
                        <div>
                          <dt className="sr-only">Questions</dt>
                          <dd>
                            {c.questionCount} question{c.questionCount === 1 ? "" : "s"}
                          </dd>
                        </div>
                        <div>
                          <dt className="sr-only">Time limit</dt>
                          <dd>{minutesLabel(c.timeLimitSeconds)}</dd>
                        </div>
                      </dl>
                      {c.description && <p className="mt-3 line-clamp-2 text-sm text-ink-600">{c.description}</p>}
                      <div className="mt-4 flex items-center justify-between gap-2 pt-1">
                        <span className="text-xs text-ink-500">
                          {isCreator ? "Your challenge" : mine?.inProgressId ? "Attempt in progress" : done ? `Best: ${mine.score}/${mine.maxScore} · ${mine.attempts}/${c.maxAttempts} attempts` : user ? `${c.maxAttempts} attempt${c.maxAttempts === 1 ? "" : "s"}` : "Sign in to play"}
                        </span>
                        {user ? (
                          <ButtonLink href={`/challenges/${c.id}`} size="sm" variant={isCreator || done || !isToday ? "outline" : "primary"}>
                            {isCreator ? "View" : mine?.inProgressId ? "Continue" : done || !isToday ? "Results" : "Start"}
                          </ButtonLink>
                        ) : (
                          <ButtonLink href={`/login?next=/challenges/${c.id}`} size="sm">
                            Sign in to start
                          </ButtonLink>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="mt-10 text-sm text-ink-500">
        How points, streaks and rewards work:{" "}
        <Link href="/how-rewards-work" className="font-semibold text-brand-600 hover:underline">
          read the rules
        </Link>
        .
      </p>
    </div>
  );
}
