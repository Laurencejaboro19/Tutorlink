import Link from "next/link";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { listReferrals } from "@/server/admin";
import { humanize } from "../_components/labels";
import { AdminPagination, FilterBar, FilterField, FilterInput, FilterSelect, pageNum, ResultCount, StatusBadge, str, TableWrap, When } from "../_components/table";
import { FlagForm, ReverseMilestoneForm } from "./referral-actions";

export const metadata = { title: "Referrals & credits · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminReferralsPage({ searchParams }: PageProps<"/admin/referrals">) {
  const viewer = await requireAdmin();
  const sp = await searchParams;
  const f = { flagged: str(sp, "flagged"), q: str(sp, "q") };
  const data = await listReferrals({ ...f, page: pageNum(sp) });
  const canMod = viewer.adminRole === "super" || viewer.adminRole === "moderator";
  const canFinance = viewer.adminRole === "super" || viewer.adminRole === "finance";
  return (
    <>
      <PageHeader title="Referrals & credits" description="Milestone payouts and abuse signals. Flagged referrals stop earning." />
      <FilterBar action="/admin/referrals">
        <FilterField label="Flagged" name="flagged">
          <FilterSelect name="flagged" value={f.flagged} options={[{ value: "yes", label: "Flagged only" }, { value: "no", label: "Not flagged" }]} />
        </FilterField>
        <FilterField label="Referrer or referred email" name="q">
          <FilterInput name="q" value={f.q} />
        </FilterField>
      </FilterBar>
      <ResultCount total={data.total} page={data.page} pageCount={data.pageCount} />
      {data.rows.length === 0 ? (
        <EmptyState title="No referrals match" />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Referrer</th>
              <th>Referred</th>
              <th>Kind</th>
              <th>Signals</th>
              <th>Milestones</th>
              <th>Created</th>
              {canMod && <th></th>}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.referral.id}>
                <td>
                  <Link href={`/admin/users/${r.referral.referrerId}`} className="font-semibold text-brand-600 hover:underline">
                    {r.referrerEmail}
                  </Link>
                </td>
                <td>
                  <Link href={`/admin/users/${r.referral.referredUserId}`} className="text-brand-600 hover:underline">
                    {r.referredEmail}
                  </Link>
                  <div className="text-xs text-ink-500">onboarding: {humanize(r.referredOnboarding).toLowerCase()}</div>
                </td>
                <td>{humanize(r.referral.kind)}</td>
                <td>
                  <div className="flex max-w-[220px] flex-wrap gap-1">
                    {r.referral.flagged && <Badge tone="danger">Flagged</Badge>}
                    {r.sameIp && <Badge tone="warning">Same IP as referrer</Badge>}
                    {r.incompleteOnboarding && <Badge tone="warning">Never completed onboarding</Badge>}
                    {!r.referral.flagged && !r.sameIp && !r.incompleteOnboarding && <span className="text-xs text-ink-400">None</span>}
                  </div>
                  {r.referral.flagReason && <div className="mt-1 max-w-[220px] whitespace-normal text-xs text-ink-500">{r.referral.flagReason}</div>}
                  {r.referral.signupIp && <div className="text-xs text-ink-400">IP {r.referral.signupIp}</div>}
                </td>
                <td>
                  {r.events.length === 0 ? (
                    <span className="text-xs text-ink-400">None yet</span>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {r.events.map(({ event: e, creditStatus }) => (
                        <li key={e.id} className="flex flex-wrap items-center gap-2">
                          <span>{humanize(e.milestone)}</span>
                          <span className="tabular-nums">{formatNgn(e.amountNgn)}</span>
                          <StatusBadge status={creditStatus ?? "pending"} />
                          {canFinance && e.creditEntryId && creditStatus === "available" && <ReverseMilestoneForm entryId={e.creditEntryId} />}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>
                  <When d={r.referral.createdAt} />
                </td>
                {canMod && (
                  <td>
                    <FlagForm referralId={r.referral.id} flagged={r.referral.flagged} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <AdminPagination base="/admin/referrals" params={f} page={data.page} pageCount={data.pageCount} />
    </>
  );
}
