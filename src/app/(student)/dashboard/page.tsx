import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader, Stat, buttonClass } from "@/components/ui";
import { requireStudent } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { formatDateTime, relativeDays } from "@/lib/time";
import { countStudentBookings, nextSession } from "@/server/booking-queries";
import { creditBalance } from "@/server/credits";

export const metadata = { title: "Student overview" };
export const dynamic = "force-dynamic";

export default async function StudentDashboardPage() {
  const user = await requireStudent();
  const [next, counts, credits] = await Promise.all([nextSession(user.id, "student"), countStudentBookings(user.id), creditBalance(user.id)]);
  const first = user.displayName ?? user.fullName.split(" ")[0];
  const hour = Number(new Intl.DateTimeFormat("en-NG", { hour: "numeric", hour12: false, timeZone: "Africa/Lagos" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        title={`${greeting}, ${first}`}
        description="Your sessions, credits and quick links."
        action={
          <Link href="/tutors" className={buttonClass("primary", "sm")}>
            Find a tutor
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Upcoming sessions" value={counts.upcoming} />
        <Stat label="Completed sessions" value={counts.completed} />
        <Stat label="Needs action" value={counts.needsAction} hint={counts.needsAction ? "Payments, reviews or ended sessions" : "All clear"} tone={counts.needsAction ? "brand" : undefined} />
        <Stat label="Credit balance" value={formatNgn(credits)} hint="Usable on bookings (up to 50% of the price)" tone="teal" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Next session" action={next ? <Badge tone="success">Confirmed</Badge> : undefined} />
          <div className="px-5 pb-5">
            {next ? (
              <>
                <p className="font-semibold text-ink-900">{next.packageTitle}</p>
                <p className="text-sm text-ink-600">
                  {next.subject} · with {next.counterpart} · {next.format === "physical" ? "In person" : "Online"}
                </p>
                <p className="mt-2 text-sm text-ink-700">
                  <time dateTime={next.startsAt.toISOString()}>{formatDateTime(next.startsAt)}</time> <span className="text-ink-400">({relativeDays(next.startsAt)})</span>
                </p>
                <Link href={`/dashboard/bookings/${next.id}`} className={buttonClass("outline", "sm", "mt-4")}>
                  View details
                </Link>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-600">No confirmed sessions coming up.</p>
                <Link href="/tutors" className={buttonClass("secondary", "sm", "mt-4")}>
                  Browse tutors
                </Link>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Quick links" />
          <ul className="grid gap-2 px-5 pb-5 sm:grid-cols-2">
            {[
              { href: "/dashboard/bookings", label: "My sessions", d: "Pay, join, review" },
              { href: "/tutors", label: "Find tutors", d: "Near you or online" },
              { href: "/challenges", label: "Daily challenges", d: "Practise and earn points" },
              { href: "/leaderboard", label: "Leaderboard", d: "Rankings and rewards" },
              { href: "/dashboard/credits", label: "Credits & rewards", d: formatNgn(credits) + " available" },
              { href: "/dashboard/referrals", label: "Refer & earn", d: "Invite friends for credits" },
            ].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="block rounded-[var(--radius-md)] border border-ink-200 p-3 hover:border-brand-300 hover:bg-brand-50">
                  <span className="block text-sm font-semibold text-ink-900">{l.label}</span>
                  <span className="block text-xs text-ink-500">{l.d}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
