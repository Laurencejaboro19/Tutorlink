import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { reportStatusEnum } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { listReports, REPORT_TARGETS } from "@/server/admin";
import { humanize } from "../_components/labels";
import { AdminPagination, enumOptions, FilterBar, FilterField, FilterSelect, pageNum, ResultCount, StatusBadge, str, TableWrap, When } from "../_components/table";

export const metadata = { title: "Reports · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  await requireAdmin();
  const sp = await searchParams;
  const f = { status: str(sp, "status") ?? "open", type: str(sp, "type") };
  const data = await listReports({ ...f, page: pageNum(sp) });
  return (
    <>
      <PageHeader title="Reports" description="Problems reported by users. Open reports notify moderators and super admins." />
      <FilterBar action="/admin/reports" reset="/admin/reports?status=all">
        <FilterField label="Status" name="status">
          <FilterSelect name="status" value={f.status === "all" ? "" : f.status} allLabel="All statuses" options={enumOptions(reportStatusEnum.enumValues)} />
        </FilterField>
        <FilterField label="Target" name="type">
          <FilterSelect name="type" value={f.type} options={enumOptions(REPORT_TARGETS)} />
        </FilterField>
      </FilterBar>
      <ResultCount total={data.total} page={data.page} pageCount={data.pageCount} />
      {data.rows.length === 0 ? (
        <EmptyState title="No reports" description="Nothing in this state." />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Received</th>
              <th>Status</th>
              <th>Target</th>
              <th>Reason</th>
              <th>Reporter</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(({ report: r, reporterEmail }) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/admin/reports/${r.id}`} className="font-semibold text-brand-600 hover:underline">
                    <When d={r.createdAt} />
                  </Link>
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>
                  {humanize(r.targetType)} <span className="text-xs text-ink-400">{r.targetId.slice(0, 8)}</span>
                </td>
                <td>{humanize(r.reason)}</td>
                <td className="text-ink-600">{reporterEmail}</td>
                <td className="max-w-[320px] truncate text-ink-600">{r.details ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <AdminPagination base="/admin/reports" params={f} page={data.page} pageCount={data.pageCount} />
    </>
  );
}
