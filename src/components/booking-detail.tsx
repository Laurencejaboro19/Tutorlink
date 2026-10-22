import { Badge, Card, CardHeader } from "./ui";
import { formatNgn } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { bookingStatus } from "@/server/booking-queries";
import type { Booking } from "@/server/bookings";

const PLAN_NAMES: Record<string, string> = { free: "Free", premium: "Premium", premium_plus: "Premium+" };

export function BookingStatusHeader({ booking }: { booking: Booking }) {
  const st = bookingStatus(booking.status);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={st.tone}>{st.label}</Badge>
      <Badge tone="neutral">{booking.format === "physical" ? "In person" : "Online"}</Badge>
      <span className="text-sm text-ink-500">Booking ref {booking.id.slice(0, 8).toUpperCase()}</span>
    </div>
  );
}

export function BookingTimeline({ booking }: { booking: Booking }) {
  const steps: { label: string; at: Date | null; done: boolean; note?: string }[] = [
    { label: "Booked", at: booking.createdAt, done: true },
    { label: "Payment confirmed", at: booking.confirmedAt, done: !!booking.confirmedAt, note: booking.status === "pending_payment" ? `Pay before ${booking.holdExpiresAt ? formatDateTime(booking.holdExpiresAt) : "the hold expires"}` : undefined },
    { label: "Tutor acknowledged", at: booking.tutorFirstResponseAt, done: !!booking.tutorFirstResponseAt },
    { label: "Session", at: booking.startsAt, done: booking.endsAt.getTime() < new Date().getTime() },
  ];
  if (booking.status === "completed") steps.push({ label: "Completed", at: booking.completedAt, done: true });
  else if (booking.cancelledAt || ["cancelled_by_student", "cancelled_by_tutor", "no_show_student", "no_show_tutor", "refunded", "expired"].includes(booking.status))
    steps.push({ label: bookingStatus(booking.status).label, at: booking.cancelledAt ?? booking.updatedAt, done: true, note: booking.cancellationReason ?? undefined });
  else if (booking.status === "disputed") steps.push({ label: "Under review", at: booking.updatedAt, done: true, note: booking.cancellationReason ?? undefined });
  return (
    <Card>
      <CardHeader title="Status" />
      <ol className="px-5 pb-5">
        {steps.map((s, i) => (
          <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${s.done ? "bg-teal-500 text-white" : "border border-ink-300 bg-white text-ink-400"}`} aria-hidden="true">
              {s.done ? "✓" : i + 1}
            </span>
            <div className="min-w-0">
              <p className={`text-sm font-medium ${s.done ? "text-ink-900" : "text-ink-500"}`}>
                {s.label}
                <span className="sr-only">{s.done ? " (done)" : " (pending)"}</span>
              </p>
              {s.at && s.done && <p className="text-xs text-ink-500">{formatDateTime(s.at)}</p>}
              {s.note && <p className="mt-0.5 text-xs text-ink-600">{s.note}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function PriceBreakdown({ booking, side }: { booking: Booking; side: "student" | "tutor" }) {
  return (
    <Card>
      <CardHeader title={side === "student" ? "What you pay" : "Earnings for this session"} />
      <dl className="space-y-1.5 px-5 pb-5 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-600">Package price</dt>
          <dd className="text-ink-900">{formatNgn(booking.priceNgn)}</dd>
        </div>
        {side === "student" ? (
          <>
            <div className="flex justify-between">
              <dt className="text-ink-600">Credits applied</dt>
              <dd className="text-ink-900">− {formatNgn(booking.creditAppliedNgn)}</dd>
            </div>
            <div className="flex justify-between border-t border-ink-100 pt-2 font-bold">
              <dt className="text-ink-900">Amount due</dt>
              <dd className="text-ink-900">{formatNgn(booking.amountDueNgn)}</dd>
            </div>
            <p className="pt-1 text-xs text-ink-500">Platform commission is handled on the tutor side.</p>
          </>
        ) : (
          <>
            <div className="flex justify-between">
              <dt className="text-ink-600">
                Platform commission ({Number(booking.commissionPct)}%, {PLAN_NAMES[booking.planCodeAtBooking] ?? booking.planCodeAtBooking} plan at booking)
              </dt>
              <dd className="text-ink-900">− {formatNgn(booking.commissionNgn)}</dd>
            </div>
            <div className="flex justify-between border-t border-ink-100 pt-2 font-bold">
              <dt className="text-ink-900">Your earning</dt>
              <dd className="text-ink-900">{formatNgn(booking.tutorEarningNgn)}</dd>
            </div>
            <p className="pt-1 text-xs text-ink-500">Credits the student used ({formatNgn(booking.creditAppliedNgn)}) are funded by the platform; you are paid on the full price. Earnings become payable after the session is completed.</p>
          </>
        )}
      </dl>
    </Card>
  );
}
