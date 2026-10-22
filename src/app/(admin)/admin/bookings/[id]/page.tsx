import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { getBookingDetail } from "@/server/admin";
import { humanize } from "../../_components/labels";
import { AuditTrail, DL, StatusBadge, When } from "../../_components/table";
import { AdminCancelForm, InternalNoteForm, ResolveDisputeForm } from "./booking-actions";

export const dynamic = "force-dynamic";

export default async function AdminBookingDetailPage({ params }: PageProps<"/admin/bookings/[id]">) {
  const viewer = await requireAdmin();
  const { id } = await params;
  const d = await getBookingDetail(id);
  if (!d) notFound();
  const b = d.booking;
  const canMod = viewer.adminRole === "super" || viewer.adminRole === "moderator";
  const cancellable = ["confirmed", "pending_payment"].includes(b.status);
  return (
    <>
      <PageHeader eyebrow={<Link href="/admin/bookings" className="hover:underline">← Bookings</Link>} title={<>Booking {b.id.slice(0, 8)}</>} description={d.pkg?.title ?? "Package removed"} action={<StatusBadge status={b.status} />} />
      {b.status === "disputed" && (
        <Alert tone="warning" title="Disputed" className="mb-4">
          {b.cancellationReason ?? "A party reported a problem with this session."}
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Session" />
            <div className="px-5 pb-5">
              <DL
                items={[
                  { label: "Starts", value: <When d={b.startsAt} /> },
                  { label: "Ends", value: <When d={b.endsAt} /> },
                  { label: "Format", value: humanize(b.format) },
                  { label: "Student", value: d.student ? <Link href={`/admin/users/${d.student.id}`} className="text-brand-600 hover:underline">{d.student.fullName} · {d.student.email}</Link> : null },
                  { label: "Tutor", value: d.tutor ? <Link href={`/admin/users/${d.tutor.id}`} className="text-brand-600 hover:underline">{d.tutor.fullName} · {d.tutor.email}</Link> : null },
                  { label: "Package", value: d.pkg ? `${d.pkg.title} (${d.pkg.durationMinutes} min)` : null },
                  { label: "Address note", value: b.addressNote },
                  { label: "Meeting link", value: b.meetingLink },
                  { label: "Student note", value: b.studentNote },
                  { label: "Hold expires", value: <When d={b.holdExpiresAt} /> },
                  { label: "Confirmed", value: <When d={b.confirmedAt} /> },
                  { label: "Completed", value: <When d={b.completedAt} /> },
                  { label: "Cancelled", value: <When d={b.cancelledAt} /> },
                  { label: "Cancellation reason", value: b.cancellationReason },
                  { label: "Tutor first response", value: <When d={b.tutorFirstResponseAt} /> },
                  { label: "Rescheduled from", value: b.rescheduledFromId ? <Link href={`/admin/bookings/${b.rescheduledFromId}`} className="text-brand-600 hover:underline">{b.rescheduledFromId.slice(0, 8)}</Link> : null },
                  { label: "Created", value: <When d={b.createdAt} /> },
                ]}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Money" description="Snapshot taken at booking time; plan changes later never alter it." />
            <div className="px-5 pb-5">
              <DL
                items={[
                  { label: "Price", value: formatNgn(b.priceNgn) },
                  { label: "Credits applied", value: formatNgn(b.creditAppliedNgn) },
                  { label: "Amount due (cash)", value: formatNgn(b.amountDueNgn) },
                  { label: "Plan at booking", value: humanize(b.planCodeAtBooking) },
                  { label: "Commission", value: `${formatNgn(b.commissionNgn)} (${Number(b.commissionPct)}%)` },
                  { label: "Tutor earning", value: formatNgn(b.tutorEarningNgn) },
                  {
                    label: "Payment",
                    value: d.payment ? (
                      <Link href={`/admin/payments/${d.payment.id}`} className="text-brand-600 hover:underline">
                        {d.payment.reference} · {humanize(d.payment.status)}
                      </Link>
                    ) : (
                      "No payment (credits only or unpaid)"
                    ),
                  },
                ]}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Ledger entries" />
            {d.ledger.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-ink-500">No ledger rows for this booking.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tl-table min-w-[520px]">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Kind</th>
                      <th>Memo</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.ledger.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <When d={l.createdAt} />
                        </td>
                        <td>{humanize(l.kind)}</td>
                        <td className="whitespace-normal text-ink-600">{l.memo}</td>
                        <td className={`text-right tabular-nums ${l.amountNgn.startsWith("-") ? "text-danger-600" : ""}`}>{formatNgn(l.amountNgn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Refunds" action={<Link href="/admin/payments/refunds" className="text-sm font-semibold text-brand-600 hover:underline">Refund queue →</Link>} />
            {d.refunds.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-ink-500">No refunds.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {d.refunds.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <div>
                      <span className="font-semibold">{formatNgn(r.amountNgn)}</span> <span className="text-ink-500">· {r.reason}</span>
                      {r.reviewNote && <div className="text-xs text-ink-500">Note: {r.reviewNote}</div>}
                    </div>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {d.review && (
            <Card>
              <CardHeader title="Review" action={<StatusBadge status={d.review.status} />} />
              <p className="px-5 pb-5 text-sm text-ink-700">
                {d.review.rating}★ {d.review.comment}
              </p>
            </Card>
          )}
          <Card>
            <CardHeader title="Audit trail" description="Includes internal notes" />
            <AuditTrail rows={d.trail} />
          </Card>
        </div>
        <div className="space-y-6">
          {canMod && b.status === "disputed" && (
            <Card>
              <CardHeader title="Resolve dispute" />
              <div className="px-5 pb-5">
                <ResolveDisputeForm bookingId={b.id} />
              </div>
            </Card>
          )}
          {canMod && cancellable && (
            <Card>
              <CardHeader title="Admin cancel" />
              <div className="px-5 pb-5">
                <AdminCancelForm bookingId={b.id} />
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Internal note" />
            <div className="px-5 pb-5">
              <InternalNoteForm bookingId={b.id} />
            </div>
          </Card>
          {!canMod && <p className="text-xs text-ink-500">Dispute resolution and cancellation are moderator actions.</p>}
        </div>
      </div>
    </>
  );
}
