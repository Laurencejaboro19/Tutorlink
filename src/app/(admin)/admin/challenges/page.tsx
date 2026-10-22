import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { challengeStatusEnum } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/time";
import { listChallenges } from "@/server/admin";
import { humanize } from "../_components/labels";
import { AdminPagination, enumOptions, FilterBar, FilterField, FilterInput, FilterSelect, pageNum, ResultCount, StatusBadge, str, TableWrap, When } from "../_components/table";

export const metadata = { title: "Challenge review · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminChallengesPage({ searchParams }: PageProps<"/admin/challenges">) {
  await requireAdmin();
  const sp = await searchParams;
  const f = { status: str(sp, "status") ?? "in_review", q: str(sp, "q") };
  const data = await listChallenges({ ...f, page: pageNum(sp) });
  return (
    <>
      <PageHeader title="Challenge review" description="Tutor-created challenges wait here before students can see them." />
      <FilterBar action="/admin/challenges" reset="/admin/challenges?status=all">
        <FilterField label="Status" name="status">
          <FilterSelect name="status" value={f.status === "all" ? "" : f.status} allLabel="All statuses" options={enumOptions(challengeStatusEnum.enumValues)} />
        </FilterField>
        <FilterField label="Title or creator email" name="q">
          <FilterInput name="q" value={f.q} />
        </FilterField>
      </FilterBar>
      <ResultCount total={data.total} page={data.page} pageCount={data.pageCount} />
      {data.rows.length === 0 ? (
        <EmptyState title="Nothing to review" description="No challenges match this filter." />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Challenge</th>
              <th>Status</th>
              <th>Creator</th>
              <th>Scheduled</th>
              <th className="text-right">Attempts</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(({ challenge: c, creatorEmail, creatorName, attempts }) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/admin/challenges/${c.id}`} className="font-semibold text-brand-600 hover:underline">
                    {c.title}
                  </Link>
                  <div className="text-xs text-ink-500">
                    {humanize(c.category)}
                    {c.level ? ` · ${humanize(c.level)}` : ""}
                  </div>
                </td>
                <td>
                  <StatusBadge status={c.status} />
                </td>
                <td>
                  <div>{creatorName}</div>
                  <div className="text-xs text-ink-500">{creatorEmail}</div>
                </td>
                <td>{formatDate(c.scheduledFor)}</td>
                <td className="text-right tabular-nums">{attempts}</td>
                <td>
                  <When d={c.updatedAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <AdminPagination base="/admin/challenges" params={f} page={data.page} pageCount={data.pageCount} />
    </>
  );
}
