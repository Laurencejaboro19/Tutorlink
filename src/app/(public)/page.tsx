import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { lgas, subjects, tutorProfiles } from "@/db/schema";
import { buttonClass } from "@/components/ui";
import { listStates } from "@/server/reference";
import { HomeSearch } from "./home-search";

export default async function HomePage() {
  const [states, subjectRows, [{ n: tutorCount }], [{ n: lgaCount }]] = await Promise.all([
    listStates(),
    db.select({ id: subjects.id, name: subjects.name, slug: subjects.slug, category: subjects.category }).from(subjects).where(eq(subjects.active, true)),
    db.select({ n: count() }).from(tutorProfiles).where(eq(tutorProfiles.isListed, true)),
    db.select({ n: count() }).from(lgas),
  ]);

  return (
    <>
      <section className="border-b border-ink-100 bg-gradient-to-b from-brand-50/70 to-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:py-20">
          <div className="lg:col-span-7">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-teal-700 shadow-[var(--shadow-card)]">
              <span className="h-2 w-2 rounded-full bg-teal-500" aria-hidden="true" /> Built for Nigeria · {lgaCount} LGAs covered
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-ink-900 sm:text-5xl">
              Trusted tutors <span className="text-brand-600">near you</span>, and <span className="text-teal-500">online</span>.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-ink-600">
              Search verified tutors by subject, exam and location, compare packages, book and pay securely, then keep your streak going with daily challenges and rewards.
            </p>
            <div className="mt-8">
              <HomeSearch states={states} subjects={subjectRows} />
            </div>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-500">
              <span>✓ Identity &amp; qualification checks</span>
              <span>✓ Pay only after a verified checkout</span>
              <span>✓ Reviews from real sessions</span>
            </div>
          </div>
          <div className="lg:col-span-5">
            <div className="tl-card overflow-hidden">
              <div className="border-b border-ink-100 bg-ink-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-500">How TutorLink works</div>
              <ol className="divide-y divide-ink-100">
                {[
                  ["Tell us where you are", "State → LGA → city, so we surface tutors who can actually reach you."],
                  ["Compare tutors & packages", "Filter by subject, exam, level, price, rating and format. Organic ranking is performance-based."],
                  ["Book & pay securely", "Checkout through Flutterwave; your session is confirmed only after the payment is verified."],
                  ["Learn, review, earn", "Rate completed sessions, take daily challenges, climb the leaderboard, refer friends."],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-4 px-5 py-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                    <div>
                      <p className="font-semibold text-ink-900">{t}</p>
                      <p className="text-sm text-ink-500">{d}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-ink-900">Popular subjects</h2>
            <p className="mt-1 text-ink-500">From Common Entrance to university-level courses.</p>
          </div>
          <Link href="/tutors" className="text-sm font-semibold text-brand-600 hover:underline">
            Browse all tutors →
          </Link>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {subjectRows.slice(0, 12).map((s) => (
            <Link key={s.id} href={`/tutors?subject=${s.id}`} className="tl-card flex items-center justify-between px-4 py-3 transition-colors hover:border-brand-200">
              <span className="font-medium text-ink-900">{s.name}</span>
              <span className="text-xs text-ink-400">{s.category}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-ink-50">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-3">
          {[
            ["Daily challenges", "Short, reviewed quizzes in WAEC Maths, JAMB Physics, university Chemistry, programming and more. Scores are computed server-side.", "/challenges"],
            ["Leaderboards & rewards", "Rank by subject, city, state or nationwide. Every 30 days the top 10 eligible students earn ₦5,000 rewards.", "/how-rewards-work"],
            ["Refer & earn", "₦500 when a friend verifies and starts learning, ₦500 more after their first session. Tutors earn up to ₦3,000 per referral.", "/dashboard/referrals"],
          ].map(([t, d, href]) => (
            <div key={t} className="tl-card p-6">
              <h3 className="text-lg font-semibold text-ink-900">{t}</h3>
              <p className="mt-2 text-sm text-ink-600">{d}</p>
              <Link href={href} className="mt-4 inline-block text-sm font-semibold text-brand-600 hover:underline">
                Learn more →
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="rounded-[var(--radius-xl)] bg-brand-600 px-6 py-10 text-white sm:px-10 lg:flex lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <h2 className="text-2xl font-bold">Teach on TutorLink</h2>
            <p className="mt-2 text-brand-100">
              {tutorCount > 0 ? `Join ${tutorCount} listed tutors.` : "Be among the first tutors listed."} Publish packages, set your service areas, get paid after each verified session. Free to start — Premium and Premium+ lower your commission to 20% and 10%.
            </p>
          </div>
          <div className="mt-6 flex gap-3 lg:mt-0">
            <Link href="/register?as=tutor" className={buttonClass("secondary", "lg")}>
              Become a tutor
            </Link>
            <Link href="/pricing" className={buttonClass("outline", "lg", "border-white/30 bg-white/10 text-white hover:bg-white/20")}>
              See plans
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
