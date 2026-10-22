import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader, Stat, StarRating, buttonClass } from "@/components/ui";
import { requireTutor } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { formatDateTime, relativeDays } from "@/lib/time";
import { countTutorBookings, listTutorBookings } from "@/server/booking-queries";
import { tutorBalances } from "@/server/ledger";
import { canPublishAnotherPackage, getActivePlan } from "@/server/plans";
import { listingRequirements } from "@/server/tutor-profile";

export const metadata = { title: "Tutor overview" };
export const dynamic = "force-dynamic";

export default async function TutorDashboardPage() {
  const user = await requireTutor();
  const [listing, counts, upcoming, balances, { plan }, cap] = await Promise.all([
    listingRequirements(user.id),
    countTutorBookings(user.id),
    listTutorBookings(user.id, "upcoming", 1),
    tutorBalances(user.id),
    getActivePlan(user.id),
    canPublishAnotherPackage(user.id),
  ]);
  const profile = listing.profile;
  const first = user.displayName ?? user.fullName.split(" ")[0];
  const checklist = [
    ...listing.requirements,
    { key: "package", label: "At least one published package", met: cap.published > 0, href: "/tutor/packages", hint: "Students book packages, not profiles." },
  ];
  const metCount = checklist.filter((c) => c.met).length;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${first}`}
        description={profile?.isListed ? "Your profile is live in search." : "Finish the checklist to get listed and start receiving bookings."}
        action={
          <Link href="/tutor/packages/new" className={buttonClass("primary", "sm")}>
            New package
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Upcoming sessions" value={counts.upcoming} />
        <Stat label="Awaiting acknowledgement" value={counts.pendingAck} hint={counts.pendingAck ? "Respond fast to protect your ranking" : "Nothing pending"} tone={counts.pendingAck ? "brand" : undefined} />
        <Stat label="Completed sessions" value={profile?.completedSessions ?? counts.completed} />
        <Stat label="Available earnings" value={formatNgn(balances.available)} hint={`Lifetime ${formatNgn(balances.lifetimeEarnings)}`} tone="teal" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Verification & listing checklist"
            description={`${metCount} of ${checklist.length} done`}
            action={profile?.isListed ? <Badge tone="success">Listed</Badge> : <Badge tone="warning">Not listed</Badge>}
          />
          <ul className="space-y-2 px-5 pb-5">
            {checklist.map((r) => (
              <li key={r.key} className="flex items-start gap-3 text-sm">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${r.met ? "bg-teal-500 text-white" : "bg-ink-100 text-ink-500"}`} aria-hidden="true">
                  {r.met ? "✓" : "–"}
                </span>
                <span>
                  <span className="font-medium text-ink-900">
                    {r.label} <span className="sr-only">{r.met ? "(done)" : "(to do)"}</span>
                  </span>
                  {!r.met && (
                    <span className="block text-ink-500">
                      {r.hint}{" "}
                      <Link href={r.href} className="font-semibold text-brand-600 hover:underline">
                        Go
                      </Link>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Reputation" />
            <div className="px-5 pb-5 text-sm">
              <StarRating value={Number(profile?.ratingAvg ?? 0)} count={profile?.ratingCount ?? 0} size={18} />
              <p className="mt-2 text-ink-600">
                Rank score {Number(profile?.rankScore ?? 0).toFixed(2)} · {profile?.cancelledByTutor ?? 0} cancellation{profile?.cancelledByTutor === 1 ? "" : "s"} by you
              </p>
              <p className="mt-1 text-xs text-ink-500">Ranking rewards reviews, completed sessions, fast acknowledgements and verified credentials.</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Plan" action={<Badge tone={plan.code === "free" ? "neutral" : "teal"}>{plan.name}</Badge>} />
            <div className="px-5 pb-5 text-sm text-ink-600">
              <p>
                {Number(plan.commissionPct)}% commission · {cap.published} of {cap.limit === null ? "unlimited" : cap.limit} published packages
              </p>
              <Link href="/tutor/subscription" className="mt-2 inline-block font-semibold text-brand-600 hover:underline">
                {plan.code === "free" ? "Upgrade to lower your commission" : "Manage subscription"}
              </Link>
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Upcoming sessions"
          action={
            <Link href="/tutor/bookings" className="text-sm font-semibold text-brand-600 hover:underline">
              All bookings
            </Link>
          }
        />
        <div className="px-5 pb-5">
          {upcoming.rows.length === 0 ? (
            <p className="text-sm text-ink-500">No upcoming sessions.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {upcoming.rows.slice(0, 5).map((b) => (
                <li key={b.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Link href={`/tutor/bookings/${b.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                      {b.packageTitle}
                    </Link>
                    <p className="text-sm text-ink-600">
                      {b.subject} · {b.counterpart} · {b.format === "physical" ? "In person" : "Online"}
                      {b.status === "confirmed" && !b.tutorFirstResponseAt && <Badge tone="warning" className="ml-2">Acknowledge</Badge>}
                    </p>
                  </div>
                  <p className="text-sm text-ink-700">
                    {formatDateTime(b.startsAt)} <span className="text-ink-400">({relativeDays(b.startsAt)})</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </>
  );
}
