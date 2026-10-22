import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatusHeader, BookingTimeline, PriceBreakdown } from "@/components/booking-detail";
import { AcknowledgeForm, CancelBookingForm, MarkCompletedForm, MeetingLinkForm, ReportNoShowForm } from "@/components/booking-forms";
import { Alert, Avatar, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireTutor } from "@/lib/auth";
import { formatDateTime, formatTime } from "@/lib/time";
import { getBookingDetail } from "@/server/booking-queries";
import { cancellationQuote } from "@/server/bookings";

export const metadata = { title: "Booking details" };
export const dynamic = "force-dynamic";

export default async function TutorBookingDetailPage({ params }: PageProps<"/tutor/bookings/[id]">) {
  const user = await requireTutor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await getBookingDetail(id, { id: user.id, side: "tutor" });
  if (!d) notFound();
  const b = d.booking;
  const now = new Date().getTime();
  const canCancel = ["confirmed", "pending_payment"].includes(b.status) && b.startsAt.getTime() > now;
  const quote = canCancel ? await cancellationQuote(b, "tutor") : null;
  const ended = b.endsAt.getTime() <= now;
  const started = b.startsAt.getTime() <= now;
  const needsAck = b.status === "confirmed" && !b.tutorFirstResponseAt;

  return (
    <>
      <nav className="mb-4 text-sm text-ink-500" aria-label="Breadcrumb">
        <Link href="/tutor/bookings" className="hover:text-brand-600">
          Bookings
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-ink-700">{d.pkg.title}</span>
      </nav>
      <PageHeader title={d.pkg.title} description={`${d.subject} · ${formatDateTime(b.startsAt)} – ${formatTime(b.endsAt)}`} />
      <BookingStatusHeader booking={b} />

      {needsAck && (
        <Alert tone="info" title="New confirmed booking — please acknowledge" className="mt-4">
          <p>Acknowledging tells the student you have seen the booking. Your first-response time feeds into your ranking.</p>
          <div className="mt-3">
            <AcknowledgeForm bookingId={b.id} />
          </div>
        </Alert>
      )}
      {b.status === "pending_payment" && (
        <Alert tone="neutral" title="Awaiting the student's payment" className="mt-4">
          The slot is held until {b.holdExpiresAt ? formatDateTime(b.holdExpiresAt) : "the hold expires"}. Contact details are shared once payment is confirmed.
        </Alert>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Student" />
            <div className="px-5 pb-5">
              <div className="flex items-center gap-3">
                <Avatar name={d.other.name} src={d.other.avatarUrl} size={48} />
                <p className="font-semibold text-ink-900">{d.other.name}</p>
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
                {b.format === "physical" && (
                  <div>
                    <dt className="text-ink-500">Session location</dt>
                    <dd className="text-ink-900">
                      {d.locationText || "Not set"}
                      {b.addressNote && (b.status === "confirmed" || b.status === "completed") && <span className="block text-ink-600">{b.addressNote}</span>}
                    </dd>
                  </div>
                )}
                {b.studentNote && (
                  <div>
                    <dt className="text-ink-500">Student&apos;s note</dt>
                    <dd className="whitespace-pre-line text-ink-700">{b.studentNote}</dd>
                  </div>
                )}
              </dl>
            </div>
          </Card>

          {b.format === "online" && b.status === "confirmed" && (
            <Card>
              <CardHeader title="Meeting link" description="Add the link the student should join. You can update it any time before the session." />
              <div className="px-5 pb-5">
                <MeetingLinkForm bookingId={b.id} current={b.meetingLink} />
              </div>
            </Card>
          )}

          {(canCancel || (b.status === "confirmed" && (started || ended))) && (
            <Card>
              <CardHeader title="Actions" />
              <div className="flex flex-col gap-3 px-5 pb-5">
                {b.status === "confirmed" && ended && <MarkCompletedForm bookingId={b.id} role="tutor" />}
                {b.status === "confirmed" && started && <ReportNoShowForm bookingId={b.id} role="tutor" />}
                {canCancel && quote && <CancelBookingForm bookingId={b.id} role="tutor" quote={quote} paid={b.status === "confirmed"} />}
              </div>
            </Card>
          )}
        </div>
        <aside className="space-y-6">
          <BookingTimeline booking={b} />
          <PriceBreakdown booking={b} side="tutor" />
          <p className="text-xs text-ink-500">
            Problem with this student?{" "}
            <Link href={`/report?type=booking&id=${b.id}`} className="font-semibold text-brand-600 hover:underline">
              Report it
            </Link>
          </p>
        </aside>
      </div>
    </>
  );
}
