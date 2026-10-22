import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { getPaymentDetail } from "@/server/admin";
import { humanize } from "../../_components/labels";
import { AuditTrail, DL, JsonDetails, StatusBadge, When } from "../../_components/table";
import { PaymentsNav } from "../nav";
import { RefundActions, RetryWebhookButton, ReverifyButton } from "../payment-actions";

export const dynamic = "force-dynamic";

export default async function AdminPaymentDetailPage({ params }: PageProps<"/admin/payments/[id]">) {
  const viewer = await requireAdmin();
  const { id } = await params;
  const d = await getPaymentDetail(id);
  if (!d) notFound();
  const p = d.payment;
  const canFinance = viewer.adminRole === "super" || viewer.adminRole === "finance";
  return (
    <>
      <PageHeader eyebrow={<Link href="/admin/payments" className="hover:underline">← Payments</Link>} title={p.reference} description={`${humanize(p.purpose)} · ${formatNgn(p.amountNgn)}`} action={<StatusBadge status={p.status} />} />
      <PaymentsNav active="payments" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Payment" />
            <div className="px-5 pb-5">
              <DL
                items={[
                  { label: "Payer", value: d.user ? <Link href={`/admin/users/${d.user.id}`} className="text-brand-600 hover:underline">{d.user.fullName} · {d.user.email}</Link> : null },
                  { label: "Amount", value: `${formatNgn(p.amountNgn)} ${p.currency}` },
                  { label: "Provider", value: p.provider },
                  { label: "Provider tx id", value: p.providerTxId },
                  { label: "Provider ref", value: p.providerRef },
                  { label: "Provider fee", value: p.providerFeeNgn ? formatNgn(p.providerFeeNgn) : null },
                  { label: "Booking", value: p.bookingId ? <Link href={`/admin/bookings/${p.bookingId}`} className="text-brand-600 hover:underline">{p.bookingId.slice(0, 8)}</Link> : null },
                  { label: "Subscription", value: p.subscriptionId ? <Link href={`/admin/subscriptions?q=${encodeURIComponent(d.user?.email ?? "")}`} className="text-brand-600 hover:underline">{p.subscriptionId.slice(0, 8)}</Link> : null },
                  { label: "Verified", value: <When d={p.verifiedAt} /> },
                  { label: "Failure reason", value: p.failureReason },
                  { label: "Created", value: <When d={p.createdAt} /> },
                  { label: "Updated", value: <When d={p.updatedAt} /> },
                ]}
              />
              <div className="mt-4">
                <JsonDetails label="Verification payload" value={p.verificationPayload} />
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Ledger entries" />
            {d.ledger.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-ink-500">{p.status === "successful" ? "No ledger rows — re-verify to replay settlement." : "No ledger rows (payment not successful)."}</p>
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
            <CardHeader title="Webhook events" description="Events whose tx_ref matches this payment" />
            {d.events.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-ink-500">No webhook events received for this reference.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {d.events.map((e) => (
                  <li key={e.id} className="px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900">{e.eventKey}</p>
                        <p className="text-xs text-ink-500">
                          <When d={e.receivedAt} /> · outcome <StatusBadge status={e.outcome ?? "unprocessed"} />
                        </p>
                        {e.error && <p className="mt-1 break-words text-xs text-danger-600">{e.error}</p>}
                        <div className="mt-1">
                          <JsonDetails label="Payload" value={e.payload} />
                        </div>
                      </div>
                      {canFinance && e.outcome === "error" && <RetryWebhookButton eventId={e.id} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Refunds" />
            {d.refunds.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-ink-500">No refunds for this payment.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {d.refunds.map((r) => (
                  <li key={r.id} className="px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p>
                          <span className="font-semibold">{formatNgn(r.amountNgn)}</span> <StatusBadge status={r.status} />
                        </p>
                        <p className="text-ink-600">{r.reason}</p>
                        {r.reviewNote && <p className="text-xs text-ink-500">Note: {r.reviewNote}</p>}
                        {r.providerRef && <p className="text-xs text-ink-500">Provider ref: {r.providerRef}</p>}
                      </div>
                      {canFinance && <RefundActions refundId={r.id} status={r.status} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Audit trail" />
            <AuditTrail rows={d.trail} />
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Provider check" description="Asks Flutterwave for the authoritative status and applies it idempotently. Only changes anything while the payment is still 'initiated'." />
            <div className="px-5 pb-5">{canFinance ? <ReverifyButton paymentId={p.id} /> : <p className="text-sm text-ink-500">Finance only.</p>}</div>
          </Card>
        </div>
      </div>
    </>
  );
}
