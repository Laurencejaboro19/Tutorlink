import Link from "next/link";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { rewardStatusEnum } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { formatDate } from "@/lib/time";
import { listCycles, listStudentRewards, listTutorRewards } from "@/server/admin";
import { humanize } from "../_components/labels";
import { AdminPagination, enumOptions, FilterBar, FilterField, FilterSelect, pageNum, ResultCount, StatusBadge, str, TableWrap, When } from "../_components/table";
import { CycleActions, StudentRewardActions, TutorRewardActions } from "./reward-actions";

export const metadata = { title: "Rewards · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminRewardsPage({ searchParams }: PageProps<"/admin/rewards">) {
  const viewer = await requireAdmin();
  const sp = await searchParams;
  const f = { status: str(sp, "status"), cycle: str(sp, "cycle"), tstatus: str(sp, "tstatus") };
  const [students, tutors, cycles] = await Promise.all([listStudentRewards({ status: f.status, cycle: f.cycle, page: pageNum(sp) }), listTutorRewards({ status: f.tstatus, page: 1 }), listCycles()]);
  const canFinance = viewer.adminRole === "super" || viewer.adminRole === "finance";
  return (
    <>
      <PageHeader title="Rewards" description="Leaderboard cycles, student rewards (cash or credit) and tutor engagement rewards. Finance approves every payout." />

      <Card>
        <CardHeader title="Cycles" description="Finalize after the end date; distribute creates reward rows for review." />
        {cycles.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-ink-500">No cycles yet. The leaderboard cron opens one automatically.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tl-table min-w-[640px] whitespace-nowrap">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Status</th>
                  <th className="text-right">Budget</th>
                  <th>Finalized</th>
                  <th>Rewarded</th>
                  {canFinance && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/admin/rewards?cycle=${c.id}`} className="font-semibold text-brand-600 hover:underline">
                        {formatDate(c.startsAt)} → {formatDate(c.endsAt)}
                      </Link>
                      <div className="text-xs text-ink-400">{c.durationDays} days</div>
                    </td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="text-right tabular-nums">{formatNgn(c.budgetNgn)}</td>
                    <td>
                      <When d={c.finalizedAt} />
                    </td>
                    <td>
                      <When d={c.rewardedAt} />
                    </td>
                    {canFinance && (
                      <td>
                        <CycleActions cycleId={c.id} status={c.status} ended={c.ended} budgetNgn={c.budgetNgn} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <h2 className="mt-8 mb-3 text-lg font-semibold text-ink-900">Student rewards</h2>
      <FilterBar action="/admin/rewards">
        <FilterField label="Status" name="status">
          <FilterSelect name="status" value={f.status} options={enumOptions(rewardStatusEnum.enumValues)} />
        </FilterField>
        <FilterField label="Cycle" name="cycle">
          <FilterSelect name="cycle" value={f.cycle} options={cycles.map((c) => ({ value: c.id, label: `${formatDate(c.startsAt)} → ${formatDate(c.endsAt)}` }))} />
        </FilterField>
      </FilterBar>
      <ResultCount total={students.total} page={students.page} pageCount={students.pageCount} />
      {students.rows.length === 0 ? (
        <EmptyState title="No student rewards" description="Distribute a finalized cycle to create them." />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Student</th>
              <th>Cycle</th>
              <th className="text-right">Rank</th>
              <th>Kind</th>
              <th className="text-right">Amount</th>
              <th>Status</th>
              <th>Notes</th>
              {canFinance && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {students.rows.map(({ reward: r, email, name, cycleStartsAt, cycleEndsAt }) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/admin/users/${r.userId}`} className="font-semibold text-brand-600 hover:underline">
                    {name}
                  </Link>
                  <div className="text-xs text-ink-500">{email}</div>
                </td>
                <td className="text-xs">
                  {formatDate(cycleStartsAt)} → {formatDate(cycleEndsAt)}
                </td>
                <td className="text-right">#{r.rank}</td>
                <td>{humanize(r.kind)}</td>
                <td className="text-right tabular-nums">{formatNgn(r.amountNgn)}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td className="max-w-[240px] whitespace-normal text-xs text-ink-600">
                  {r.eligibilityNote && <div>{r.eligibilityNote}</div>}
                  {r.reviewNote && <div className="text-ink-500">{r.reviewNote}</div>}
                </td>
                {canFinance && (
                  <td>
                    <StudentRewardActions rewardId={r.id} status={r.status} kind={r.kind} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <AdminPagination base="/admin/rewards" params={f} page={students.page} pageCount={students.pageCount} />

      <h2 className="mt-8 mb-3 text-lg font-semibold text-ink-900">Tutor engagement rewards</h2>
      <FilterBar action="/admin/rewards">
        <FilterField label="Status" name="tstatus">
          <FilterSelect name="tstatus" value={f.tstatus} options={enumOptions(rewardStatusEnum.enumValues)} />
        </FilterField>
      </FilterBar>
      {tutors.rows.length === 0 ? (
        <EmptyState title="No tutor rewards" />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Tutor</th>
              <th>Cycle</th>
              <th>From plan</th>
              <th>Granted plan</th>
              <th className="text-right">Engagement</th>
              <th>Status</th>
              {canFinance && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {tutors.rows.map(({ reward: r, email, name, cycleStartsAt, cycleEndsAt }) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/admin/users/${r.tutorId}`} className="font-semibold text-brand-600 hover:underline">
                    {name}
                  </Link>
                  <div className="text-xs text-ink-500">{email}</div>
                </td>
                <td className="text-xs">
                  {formatDate(cycleStartsAt)} → {formatDate(cycleEndsAt)}
                </td>
                <td>{humanize(r.fromPlan)}</td>
                <td>{humanize(r.grantedPlan)}</td>
                <td className="text-right tabular-nums">{r.engagementScore}</td>
                <td>
                  <StatusBadge status={r.status} />
                  {r.reviewNote && <div className="max-w-[200px] whitespace-normal text-xs text-ink-500">{r.reviewNote}</div>}
                </td>
                {canFinance && (
                  <td>
                    <TutorRewardActions rewardId={r.id} status={r.status} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}
