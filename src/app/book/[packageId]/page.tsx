import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { exams, packages, subjects, tutorProfiles, users } from "@/db/schema";
import { Alert, Avatar, Badge, Card, CardHeader, PageHeader, StarRating, buttonClass } from "@/components/ui";
import { requireStudent } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { availableSlots } from "@/server/booking-queries";
import { quoteBooking } from "@/server/bookings";
import { creditBalance } from "@/server/credits";
import { levelLabel, listStates } from "@/server/reference";
import { BookingForm } from "./booking-form";

export const metadata = { title: "Book a session" };
export const dynamic = "force-dynamic";

export default async function BookPage({ params }: PageProps<"/book/[packageId]">) {
  const user = await requireStudent();
  const { packageId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(packageId)) notFound();

  const [row] = await db
    .select({ pkg: packages, subject: subjects.name, exam: exams.name, tutor: tutorProfiles, tutorName: users.displayName, tutorFull: users.fullName, tutorAvatar: users.avatarUrl })
    .from(packages)
    .innerJoin(subjects, eq(subjects.id, packages.subjectId))
    .leftJoin(exams, eq(exams.id, packages.examId))
    .innerJoin(tutorProfiles, eq(tutorProfiles.userId, packages.tutorId))
    .innerJoin(users, eq(users.id, packages.tutorId))
    .where(eq(packages.id, packageId))
    .limit(1);
  if (!row || row.pkg.status !== "published" || !row.tutor.isListed) notFound();
  const { pkg, tutor } = row;
  const tutorName = row.tutorName ?? row.tutorFull.split(" ")[0];

  if (pkg.tutorId === user.id) {
    return (
      <>
        <PageHeader title="Book a session" />
        <Alert tone="warning" title="This is your own package">
          You cannot book yourself. <Link href={`/tutors/${pkg.tutorId}`} className="font-semibold underline">View your public profile</Link> instead.
        </Alert>
      </>
    );
  }

  const canPhysical = (pkg.format === "physical" || pkg.format === "hybrid") && tutor.offersPhysical;
  const canOnline = (pkg.format === "online" || pkg.format === "hybrid") && tutor.offersOnline;
  const [quoteNoCredits, quoteWithCredits, balance, states, maxPct, slotsPhysical, slotsOnline, maxDays, freeCancelHours, lateRefundPct] = await Promise.all([
    quoteBooking({ packageId: pkg.id, studentId: user.id, useCredits: false }),
    quoteBooking({ packageId: pkg.id, studentId: user.id, useCredits: true }),
    creditBalance(user.id),
    listStates(),
    getSetting("credits.max_redeem_pct_of_booking"),
    canPhysical ? availableSlots(pkg, "physical") : Promise.resolve([]),
    canOnline ? availableSlots(pkg, "online") : Promise.resolve([]),
    getSetting("booking.max_days_ahead"),
    getSetting("booking.free_cancel_hours"),
    getSetting("booking.late_cancel_refund_pct"),
  ]);

  if (!canPhysical && !canOnline) {
    return (
      <>
        <PageHeader title="Book a session" />
        <Alert tone="warning" title="This package cannot be booked right now">
          The tutor&apos;s formats do not match this package. <Link href={`/tutors/${pkg.tutorId}`} className="font-semibold underline">See other packages</Link>.
        </Alert>
      </>
    );
  }

  return (
    <>
      <nav className="mb-4 text-sm text-ink-500" aria-label="Breadcrumb">
        <Link href="/tutors" className="hover:text-brand-600">
          Find tutors
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/tutors/${pkg.tutorId}`} className="hover:text-brand-600">
          {tutorName}
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-ink-700">Book</span>
      </nav>
      <PageHeader title="Book a session" description="Choose how, where and when. You only pay after confirming; the slot is held for you while you pay." />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="order-2 lg:order-1">
          <BookingForm
            packageId={pkg.id}
            canPhysical={canPhysical}
            canOnline={canOnline}
            states={states}
            studentLocation={{ stateId: user.stateId, lgaId: user.lgaId, cityId: user.cityId }}
            slots={{ physical: slotsPhysical, online: slotsOnline }}
            maxDays={maxDays}
            quote={{
              price: quoteNoCredits.price,
              creditBalance: balance,
              creditApplied: quoteWithCredits.creditApplied,
              amountDueWithCredits: quoteWithCredits.amountDue,
              amountDueWithoutCredits: quoteNoCredits.amountDue,
              maxPct,
            }}
          />
        </div>

        <aside className="order-1 lg:order-2">
          <Card>
            <CardHeader title="Package summary" />
            <div className="px-5 pb-5">
              <div className="flex items-center gap-3">
                <Avatar name={tutorName} src={row.tutorAvatar} size={44} />
                <div>
                  <p className="font-semibold text-ink-900">{tutorName}</p>
                  <StarRating value={Number(tutor.ratingAvg)} count={tutor.ratingCount} />
                </div>
              </div>
              <h2 className="mt-4 text-base font-semibold text-ink-900">{pkg.title}</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="brand">{row.subject}</Badge>
                <Badge>{levelLabel(pkg.level)}</Badge>
                {row.exam && <Badge tone="teal">{row.exam}</Badge>}
              </div>
              <dl className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-500">Sessions</dt>
                  <dd className="text-ink-900">{pkg.sessionsCount}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Duration</dt>
                  <dd className="text-ink-900">{pkg.durationMinutes} min each</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Package price</dt>
                  <dd className="font-semibold text-ink-900">{formatNgn(pkg.priceNgn)}</dd>
                </div>
              </dl>
              {pkg.requirements && (
                <p className="mt-4 text-xs text-ink-500">
                  <span className="font-semibold text-ink-700">Requirements:</span> {pkg.requirements}
                </p>
              )}
              <p className="mt-4 text-xs text-ink-500">
                Free cancellation up to {freeCancelHours} hours before the session; later cancellations refund {lateRefundPct}%. Platform commission is handled on the tutor side.
              </p>
              <Link href={`/tutors/${pkg.tutorId}`} className={buttonClass("ghost", "sm", "mt-3")}>
                ← Back to profile
              </Link>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
