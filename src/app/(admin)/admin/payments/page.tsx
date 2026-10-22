import Link from "next/link";
import { Alert, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { paymentStatusEnum } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { listPayments, reconciliation } from "@/server/admin";
import { humanize } from "../_components/labels";
import { AdminPagination, enumOptions, FilterBar, FilterField, FilterInput, FilterSelect, JsonDetails, pageNum, ResultCount, StatusBadge, str, TableWrap, When } from "../_components/table";
import { PaymentsNav } from "./nav";
import { RetryWebhookButton } from "./payment-actions";

export const metadata = { title: "Payments · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  const viewer = await requireAdmin();
  const sp = await searchParams;
  const f = { status: str(sp, "status"), purpose: str(sp, "purpose"), from: str(sp, "from"), to: str(sp, "to"), q: str(sp, "q") };
  const [data, rec] = await Promise.all([listPayments({ ...f, page: pageNum(sp) }), reconciliation()]);
  const canFinance = viewer.adminRole === "super" || viewer.adminRole === "finance";
  const feeTotal = rec.ledger.processing_fee ?? "0.00";
  return (
    <>
      <PageHeader title="Payments & refunds" description="Provider-verified payments, the ledger they produced, and anything that does not add up." />
      <PaymentsNav active="payments" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Σ successful payments" value={formatNgn(rec.successfulSum)} hint={`${rec.successfulCount} payments`} />
        <Stat label="Ledger payment_received" value={formatNgn(rec.received)} hint={rec.difference === "0.00" ? "Matches payments" : `Difference ${formatNgn(rec.difference)}`} tone={rec.difference === "0.00" ? "teal" : undefined} />
        <Stat label="Processing fees" value={formatNgn(feeTotal)} hint="Ledger processing_fee (negative)" />
        <Stat label="Refunds (ledger)" value={formatNgn(rec.ledger.refund ?? "0")} hint="Negative = money returned" />
      </div>

      {(rec.orphans.length > 0 || rec.errored.length > 0 || rec.difference !== "0.00") && (
        <Alert tone="warning" title="Reconciliation needs attention" className="mt-4">
          {rec.difference !== "0.00" && <p>Ledger and successful payments differ by {formatNgn(rec.difference)}.</p>}
          {rec.orphans.length > 0 && <p>{rec.orphans.length} successful payment(s) have no ledger rows.</p>}
          {rec.errored.length > 0 && <p>{rec.errored.length} webhook event(s) failed processing.</p>}
        </Alert>
      )}

      {rec.orphans.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Successful payments without ledger rows" description="Should be empty. Re-verify from the payment page to replay settlement." />
          <ul className="divide-y divide-ink-100">
            {rec.orphans.map(({ payment, email }) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <Link href={`/admin/payments/${payment.id}`} className="font-semibold text-brand-600 hover:underline">
                  {payment.reference}
                </Link>
                <span className="text-ink-500">{email}</span>
                <span className="tabular-nums">{formatNgn(payment.amountNgn)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rec.errored.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Webhook events with errors" description="Retry re-runs the stored payload through verification. Finance only." />
          <ul className="divide-y divide-ink-100">
            {rec.errored.map((e) => (
              <li key={e.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">{e.eventKey}</p>
                    <p className="text-xs text-ink-500">
                      <When d={e.receivedAt} /> · {e.eventType}
                    </p>
                    <p className="mt-1 break-words text-xs text-danger-600">{e.error}</p>
                    <div className="mt-1">
                      <JsonDetails label="Payload" value={e.payload} />
                    </div>
                  </div>
                  {canFinance && <RetryWebhookButton eventId={e.id} />}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <h2 className="mt-8 mb-3 text-lg font-semibold text-ink-900">All payments</h2>
      <FilterBar action="/admin/payments">
        <FilterField label="Reference / email" name="q">
          <FilterInput name="q" value={f.q} placeholder="TL-BK-…" />
        </FilterField>
        <FilterField label="Status" name="status">
          <FilterSelect name="status" value={f.status} options={enumOptions(paymentStatusEnum.enumValues)} />
        </FilterField>
        <FilterField label="Purpose" name="purpose">
          <FilterSelect name="purpose" value={f.purpose} options={[{ value: "booking", label: "Booking" }, { value: "subscription", label: "Subscription" }]} />
        </FilterField>
        <FilterField label="From" name="from">
          <FilterInput name="from" value={f.from} type="date" />
        </FilterField>
        <FilterField label="To" name="to">
          <FilterInput name="to" value={f.to} type="date" />
        </FilterField>
      </FilterBar>
      <ResultCount total={data.total} page={data.page} pageCount={data.pageCount} />
      {data.rows.length === 0 ? (
        <EmptyState title="No payments match" />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Status</th>
              <th>Purpose</th>
              <th>Payer</th>
              <th className="text-right">Amount</th>
              <th>Provider tx</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(({ payment: p, email }) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/admin/payments/${p.id}`} className="font-semibold text-brand-600 hover:underline">
                    {p.reference}
                  </Link>
                </td>
                <td>
                  <StatusBadge status={p.status} />
                </td>
                <td>{humanize(p.purpose)}</td>
                <td className="text-ink-600">{email}</td>
                <td className="text-right tabular-nums">{formatNgn(p.amountNgn)}</td>
                <td className="text-xs text-ink-500">{p.providerTxId ?? "—"}</td>
                <td>
                  <When d={p.createdAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <AdminPagination base="/admin/payments" params={f} page={data.page} pageCount={data.pageCount} />
    </>
  );
}
