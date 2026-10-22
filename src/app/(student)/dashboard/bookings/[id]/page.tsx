import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatusHeader, BookingTimeline, PriceBreakdown } from "@/components/booking-detail";
import { CancelBookingForm, MarkCompletedForm, ReportNoShowForm, ReviewForm } from "@/components/booking-forms";
import { Alert, Avatar, Card, CardHeader, PageHeader, StarRating, buttonClass } from "@/components/ui";
import { requireStudent } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { formatDateTime, formatTime } from "@/lib/time";
import { getBookingDetail, tutorRatingSummary } from "@/server/booking-queries";
import { cancellationQuote } from "@/server/bookings";

export const metadata = { title: "Session details" };
export const dynamic = "force-dynamic";

export default async function StudentBookingDetailPage({ params }: PageProps<"/dashboard/bookings/[id]">) {
  const user = await requireStudent();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await getBookingDetail(id, { id: user.id, side: "student" });
  if (!d) notFound();
  const b = d.booking;
  const now = new Date().getTime();
  const canCancel = ["confirmed", "pending_payment"].includes(b.status) && b.startsAt.getTime() > now;
  const quote = canCancel ? await cancellationQuote(b, "student") : null;
  const ended = b.endsAt.getTime() <= now;
  const started = b.startsAt.getTime() <= now;
  const reviewWindowDays = await getSetting("booking.review_window_days");
  const canReview = b.status === "completed" && !d.review && !!b.completedAt && now - b.completedAt.getTime() <= reviewWindowDays * 86_400_000;

  return (
    <>
      <nav className="mb-4 text-sm text-ink-500" aria-label="Breadcrumb">
        <Link href="/dashboard/bookings" className="hover:text-brand-600">
          My sessions
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-ink-700">{d.pkg.title}</span>
      </nav>
      <PageHeader title={d.pkg.title} description={`${d.subject} · ${formatDateTime(b.startsAt)} – ${formatTime(b.endsAt)}`} />
      <BookingStatusHeader booking={b} />

      {b.status === "pending_payment" && (
        <Alert tone="warning" title="Payment needed to confirm this session" className="mt-4">
          <p>The slot is held for you until {b.holdExpiresAt ? formatDateTime(b.holdExpiresAt) : "the hold expires"}. After that it is released.</p>
          {b.paymentId && (
            <a href={`/pay/${b.paymentId}`} className={buttonClass("primary", "sm", "mt-3")}>
              Pay now
            </a>
          )}
        </Alert>
      )}
      {b.status === "confirmed" && ended && (
        <Alert tone="info" title="How did it go?" className="mt-4">
          Mark the session completed so the tutor gets paid and you can leave a review — or report a problem if it did not happen.
        </Alert>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Your tutor" />
            <div className="px-5 pb-5">
              <div className="flex items-center gap-3">
                <Avatar name={d.other.name} src={d.other.avatarUrl} size={48} />
                <div>
                  <Link href={`/tutors/${d.other.id}`} className="font-semibold text-ink-900 hover:text-brand-600">
                    {d.other.name}
                  </Link>
                  <TutorRating tutorId={d.other.id} />
                </div>
              </div>
              <dl className="mt-4 space-y-2 text-sm">
                <div>
                  <dt className="text-ink-500">Phone</dt>
                  <dd className="text-ink-900">
                    {d.other.phone ? (
                      <a href={`tel:${d.other.phone}`} className="font-medium text-brand-600 hover:underline">
                        {d.other.phone}
                      </a>
                    ) : (
                      <span className="text-ink-500">Shared once the session is confirmed</span>
                    )}
                  </dd>
                </div>
                {b.format === "online" ? (
                  <div>
                    <dt className="text-ink-500">Meeting link</dt>
                    <dd className="text-ink-900">
                      {b.meetingLink ? (
                        <a href={b.meetingLink} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-brand-600 hover:underline">
                          {b.meetingLink}
                        </a>
                      ) : (
                        <span className="text-ink-500">The tutor will add the link before the session.</span>
                      )}
                    </dd>
                  </div>
                ) : (
                  <div>
                    <dt className="text-ink-500">Session location</dt>
                    <dd className="text-ink-900">
                      {d.locationText || "Not set"}
                      {b.addressNote && <span className="block text-ink-600">{b.addressNote}</span>}
                    </dd>
                  </div>
                )}
                {b.studentNote && (
                  <div>
                    <dt className="text-ink-500">Your note</dt>
                    <dd className="whitespace-pre-line text-ink-700">{b.studentNote}</dd>
                  </div>
                )}
              </dl>
            </div>
          </Card>

          {(canCancel || (b.status === "confirmed" && (started || ended))) && (
            <Card>
              <CardHeader title="Actions" />
              <div className="flex flex-col gap-3 px-5 pb-5">
                {b.status === "confirmed" && ended && <MarkCompletedForm bookingId={b.id} role="student" />}
                {b.status === "confirmed" && started && <ReportNoShowForm bookingId={b.id} role="student" />}
                {canCancel && quote && <CancelBookingForm bookingId={b.id} role="student" quote={quote} paid={b.status === "confirmed"} />}
              </div>
            </Card>
          )}

          {canReview && (
            <Card id="review">
              <CardHeader title="Leave a review" description={`You can review within ${reviewWindowDays} days of completion. Reviews are published on the tutor's profile.`} />
              <div className="px-5 pb-5">
                <ReviewForm bookingId={b.id} />
              </div>
            </Card>
          )}
          {d.review && (
            <Card id="review">
              <CardHeader title="Your review" />
              <div className="px-5 pb-5">
                <StarRating value={d.review.rating} />
                {d.review.comment && <p className="mt-2 text-sm text-ink-700">{d.review.comment}</p>}
              </div>
            </Card>
          )}
        </div>
        <aside className="space-y-6">
          <BookingTimeline booking={b} />
          <PriceBreakdown booking={b} side="student" />
          <p className="text-xs text-ink-500">
            Something wrong with this booking?{" "}
            <Link href={`/report?type=booking&id=${b.id}`} className="font-semibold text-brand-600 hover:underline">
              Report it
            </Link>
          </p>
        </aside>
      </div>
    </>
  );
}

async function TutorRating({ tutorId }: { tutorId: string }) {
  const r = await tutorRatingSummary(tutorId);
  if (!r) return null;
  return <StarRating value={r.ratingAvg} count={r.ratingCount} />;
}
