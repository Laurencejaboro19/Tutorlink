import Link from "next/link";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import { payoutStatusEnum } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { payoutsEnabled } from "@/server/flutterwave";
import { listPayouts, type PayoutStatus } from "@/server/payouts";
import { AdminPagination, enumOptions, FilterBar, FilterField, FilterSelect, pageNum, ResultCount, StatusBadge, str, TableWrap, When } from "../../_components/table";
import { PaymentsNav } from "../nav";
import { PayoutActions } from "../payment-actions";

export const metadata = { title: "Payouts · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPayoutsPage({ searchParams }: PageProps<"/admin/payments/payouts">) {
  const viewer = await requireAdmin();
  const sp = await searchParams;
  const status = str(sp, "status");
  const valid = status && (payoutStatusEnum.enumValues as readonly string[]).includes(status) ? (status as PayoutStatus) : undefined;
  const data = await listPayouts({ status: valid, page: pageNum(sp) });
  const canFinance = viewer.adminRole === "super" || viewer.adminRole === "finance";
  const enabled = payoutsEnabled();
  return (
    <>
      <PageHeader title="Payouts" description="Approving posts the ledger debit; executing sends the bank transfer; completion/failure is confirmed from the provider." />
      <PaymentsNav active="payouts" />
      {!enabled && (
        <Alert tone="warning" title="PAYOUTS_ENABLED is not true on this deployment" className="mb-4">
          Approvals still work, but executing a transfer will be refused by the provider gate and the payout will stay approved with the reason recorded.
        </Alert>
      )}
      <FilterBar action="/admin/payments/payouts">
        <FilterField label="Status" name="status">
          <FilterSelect name="status" value={status} options={enumOptions(payoutStatusEnum.enumValues)} />
        </FilterField>
      </FilterBar>
      <ResultCount total={data.total} page={data.page} pageCount={data.pageCount} />
      {data.rows.length === 0 ? (
        <EmptyState title="No payouts" description="Nothing in this state." />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Requested</th>
              <th>Status</th>
              <th>Reference</th>
              <th>Tutor</th>
              <th className="text-right">Amount</th>
              <th>Provider / reason</th>
              {canFinance && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {data.rows.map(({ payout: p, tutorEmail, tutorName }) => (
              <tr key={p.id}>
                <td>
                  <When d={p.createdAt} />
                </td>
                <td>
                  <StatusBadge status={p.status} />
                </td>
                <td className="font-mono text-xs">{p.reference}</td>
                <td>
                  <Link href={`/admin/users/${p.tutorId}`} className="font-semibold text-brand-600 hover:underline">
                    {tutorName}
                  </Link>
                  <div className="text-xs text-ink-500">{tutorEmail}</div>
                </td>
                <td className="text-right tabular-nums">{formatNgn(p.amountNgn)}</td>
                <td className="max-w-[260px] whitespace-normal text-xs text-ink-600">
                  {p.providerRef && <div>Provider ref {p.providerRef}</div>}
                  {p.failureReason && <div className="text-danger-600">{p.failureReason}</div>}
                </td>
                {canFinance && (
                  <td>
                    <PayoutActions payoutId={p.id} status={p.status} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <AdminPagination base="/admin/payments/payouts" params={{ status }} page={data.page} pageCount={data.pageCount} />
    </>
  );
}
