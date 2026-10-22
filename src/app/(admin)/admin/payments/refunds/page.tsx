import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { refundStatusEnum } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { listRefunds, type RefundStatus } from "@/server/refunds";
import { AdminPagination, enumOptions, FilterBar, FilterField, FilterSelect, pageNum, ResultCount, StatusBadge, str, TableWrap, When } from "../../_components/table";
import { PaymentsNav } from "../nav";
import { RefundActions } from "../payment-actions";

export const metadata = { title: "Refunds · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminRefundsPage({ searchParams }: PageProps<"/admin/payments/refunds">) {
  const viewer = await requireAdmin();
  const sp = await searchParams;
  const status = str(sp, "status");
  const valid = status && (refundStatusEnum.enumValues as readonly string[]).includes(status) ? (status as RefundStatus) : undefined;
  const data = await listRefunds({ status: valid, page: pageNum(sp) });
  const canFinance = viewer.adminRole === "super" || viewer.adminRole === "finance";
  return (
    <>
      <PageHeader title="Refunds" description="Requested → approved → executed with the provider. Provider errors are shown on the row." />
      <PaymentsNav active="refunds" />
      <FilterBar action="/admin/payments/refunds">
        <FilterField label="Status" name="status">
          <FilterSelect name="status" value={status} options={enumOptions(refundStatusEnum.enumValues)} />
        </FilterField>
      </FilterBar>
      <ResultCount total={data.total} page={data.page} pageCount={data.pageCount} />
      {data.rows.length === 0 ? (
        <EmptyState title="No refunds" description="Nothing in this state." />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Requested</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Payer</th>
              <th className="text-right">Amount</th>
              <th>Reason / notes</th>
              {canFinance && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {data.rows.map(({ refund: r, payment, payerEmail }) => (
              <tr key={r.id}>
                <td>
                  <When d={r.createdAt} />
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>
                  <Link href={`/admin/payments/${payment.id}`} className="font-semibold text-brand-600 hover:underline">
                    {payment.reference}
                  </Link>
                  {r.bookingId && (
                    <div className="text-xs">
                      <Link href={`/admin/bookings/${r.bookingId}`} className="text-ink-500 hover:underline">
                        booking {r.bookingId.slice(0, 8)}
                      </Link>
                    </div>
                  )}
                </td>
                <td className="text-ink-600">{payerEmail}</td>
                <td className="text-right tabular-nums">
                  {formatNgn(r.amountNgn)}
                  <div className="text-xs text-ink-400">of {formatNgn(payment.amountNgn)}</div>
                </td>
                <td className="max-w-[280px] whitespace-normal text-ink-600">
                  {r.reason}
                  {r.reviewNote && <div className={`mt-1 text-xs ${r.status === "failed" ? "text-danger-600" : "text-ink-500"}`}>{r.reviewNote}</div>}
                  {r.providerRef && <div className="text-xs text-ink-400">Provider ref {r.providerRef}</div>}
                </td>
                {canFinance && (
                  <td>
                    <RefundActions refundId={r.id} status={r.status} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <AdminPagination base="/admin/payments/refunds" params={{ status }} page={data.page} pageCount={data.pageCount} />
    </>
  );
}
