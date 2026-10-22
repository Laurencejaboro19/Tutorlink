import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { planCodeEnum, subscriptionPlans, subscriptionSourceEnum, subscriptionStatusEnum } from "@/db/schema";
import { Alert, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { listSubscriptions } from "@/server/admin";
import { humanize } from "../_components/labels";
import { AdminPagination, enumOptions, FilterBar, FilterField, FilterInput, FilterSelect, pageNum, ResultCount, StatusBadge, str, TableWrap, When } from "../_components/table";
import { CancelSubscriptionForm, GrantMonthForm, PlanEditor } from "./subscription-actions";

export const metadata = { title: "Subscriptions · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminSubscriptionsPage({ searchParams }: PageProps<"/admin/subscriptions">) {
  const viewer = await requireAdmin();
  const sp = await searchParams;
  const f = { status: str(sp, "status"), plan: str(sp, "plan"), source: str(sp, "source"), q: str(sp, "q") };
  const [data, plans] = await Promise.all([listSubscriptions({ ...f, page: pageNum(sp) }), db.select().from(subscriptionPlans).orderBy(asc(subscriptionPlans.sortOrder))]);
  const canFinance = viewer.adminRole === "super" || viewer.adminRole === "finance";
  const isSuper = viewer.adminRole === "super";
  return (
    <>
      <PageHeader title="Subscriptions" description="Tutor plans: paid, promotional and admin grants." />
      <FilterBar action="/admin/subscriptions">
        <FilterField label="Tutor email" name="q">
          <FilterInput name="q" value={f.q} />
        </FilterField>
        <FilterField label="Status" name="status">
          <FilterSelect name="status" value={f.status} options={enumOptions(subscriptionStatusEnum.enumValues)} />
        </FilterField>
        <FilterField label="Plan" name="plan">
          <FilterSelect name="plan" value={f.plan} options={enumOptions(planCodeEnum.enumValues)} />
        </FilterField>
        <FilterField label="Source" name="source">
          <FilterSelect name="source" value={f.source} options={enumOptions(subscriptionSourceEnum.enumValues)} />
        </FilterField>
      </FilterBar>
      <ResultCount total={data.total} page={data.page} pageCount={data.pageCount} />
      {data.rows.length === 0 ? (
        <EmptyState title="No subscriptions match" />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Tutor</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Source</th>
              <th>Period</th>
              <th>Payment</th>
              {canFinance && <th></th>}
            </tr>
          </thead>
          <tbody>
            {data.rows.map(({ sub: s, email, name, paymentRef }) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/admin/users/${s.tutorId}`} className="font-semibold text-brand-600 hover:underline">
                    {name}
                  </Link>
                  <div className="text-xs text-ink-500">{email}</div>
                </td>
                <td>{humanize(s.planCode)}</td>
                <td>
                  <StatusBadge status={s.status} />
                  {s.cancelAtPeriodEnd && <div className="text-xs text-ink-500">ends at period end</div>}
                </td>
                <td>
                  {humanize(s.source)}
                  {s.grantReason && <div className="max-w-[200px] whitespace-normal text-xs text-ink-500">{s.grantReason}</div>}
                </td>
                <td className="text-xs">
                  <When d={s.startsAt} />
                  <div>
                    → <When d={s.endsAt} />
                  </div>
                </td>
                <td className="text-xs">{paymentRef && s.paymentId ? <Link href={`/admin/payments/${s.paymentId}`} className="text-brand-600 hover:underline">{paymentRef}</Link> : "—"}</td>
                {canFinance && <td>{(s.status === "active" || s.status === "past_due" || s.status === "pending_payment") && <CancelSubscriptionForm subscriptionId={s.id} />}</td>}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <AdminPagination base="/admin/subscriptions" params={f} page={data.page} pageCount={data.pageCount} />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Grant a promotional month" description="Finance. Creates an admin_grant subscription with your reason." />
          <div className="px-5 pb-5">{canFinance ? <GrantMonthForm /> : <p className="text-sm text-ink-500">Finance only.</p>}</div>
        </Card>
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Plan table" description="Super admins edit fees, commissions and limits here." />
            <div className="px-5 pb-5">
              <Alert tone="info" className="mb-4">
                Changes apply to new bookings and new subscription periods only. Every booking stores the commission percentage that applied when it was made, so historical earnings never change.
              </Alert>
              <div className="overflow-x-auto">
                <table className="tl-table min-w-[560px]">
                  <thead>
                    <tr>
                      <th>Plan</th>
                      <th className="text-right">Fee / month</th>
                      <th className="text-right">Commission</th>
                      <th className="text-right">Max packages</th>
                      <th className="text-right">Boost</th>
                      <th>Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((p) => (
                      <tr key={p.code}>
                        <td className="font-semibold">{p.name}</td>
                        <td className="text-right tabular-nums">{formatNgn(p.monthlyFeeNgn)}</td>
                        <td className="text-right tabular-nums">{Number(p.commissionPct)}%</td>
                        <td className="text-right">{p.maxPublishedPackages ?? "Unlimited"}</td>
                        <td className="text-right">{p.visibilityBoost}</td>
                        <td className="text-xs text-ink-600">{[p.profileBoostEligible && "profile boost", p.analyticsTools && "analytics", !p.active && "inactive"].filter(Boolean).join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {isSuper && (
                <div className="mt-6 space-y-6">
                  {plans.map((p) => (
                    <details key={p.code} className="rounded-[var(--radius-md)] border border-ink-100 p-4">
                      <summary className="cursor-pointer font-semibold text-ink-900">Edit {p.name}</summary>
                      <div className="mt-4">
                        <PlanEditor plan={p} />
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
