import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { listAudit, listAuditTargetTypes } from "@/server/admin";
import { humanize } from "../_components/labels";
import { AdminPagination, FilterBar, FilterField, FilterInput, FilterSelect, JsonDetails, pageNum, ResultCount, str, TableWrap, When } from "../_components/table";

export const metadata = { title: "Audit log · Admin" };
export const dynamic = "force-dynamic";

const TARGET_HREF: Record<string, (id: string) => string> = {
  user: (id) => `/admin/users/${id}`,
  tutor: (id) => `/admin/tutors/${id}`,
  booking: (id) => `/admin/bookings/${id}`,
  payment: (id) => `/admin/payments/${id}`,
  challenge: (id) => `/admin/challenges/${id}`,
  report: (id) => `/admin/reports/${id}`,
};

export default async function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireAdmin();
  const sp = await searchParams;
  const f = { actor: str(sp, "actor"), action: str(sp, "action"), targetType: str(sp, "targetType"), targetId: str(sp, "targetId"), from: str(sp, "from"), to: str(sp, "to") };
  const [data, types] = await Promise.all([listAudit({ ...f, page: pageNum(sp) }), listAuditTargetTypes()]);
  return (
    <>
      <PageHeader title="Audit log" description="Every privileged or financial action, with before/after values. Append-only." />
      <FilterBar action="/admin/audit">
        <FilterField label="Actor (email or id)" name="actor">
          <FilterInput name="actor" value={f.actor} />
        </FilterField>
        <FilterField label="Action contains" name="action">
          <FilterInput name="action" value={f.action} placeholder="admin.user" />
        </FilterField>
        <FilterField label="Target type" name="targetType">
          <FilterSelect name="targetType" value={f.targetType} options={types.map((t) => ({ value: t, label: humanize(t) }))} />
        </FilterField>
        <FilterField label="Target id" name="targetId">
          <FilterInput name="targetId" value={f.targetId} />
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
        <EmptyState title="No audit entries match" />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
              <th>IP</th>
              <th>Diff</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(({ entry: e, actorEmail }) => {
              const href = e.targetType && e.targetId && TARGET_HREF[e.targetType] ? TARGET_HREF[e.targetType](e.targetId) : null;
              return (
                <tr key={e.id}>
                  <td>
                    <When d={e.createdAt} />
                  </td>
                  <td className="font-medium text-ink-900">{e.action}</td>
                  <td>
                    {actorEmail ? (
                      <Link href={`/admin/users/${e.actorId}`} className="text-brand-600 hover:underline">
                        {actorEmail}
                      </Link>
                    ) : (
                      <span className="text-ink-400">system</span>
                    )}
                    {e.actorRole && <div className="text-xs text-ink-500">{e.actorRole}</div>}
                  </td>
                  <td>
                    {e.targetType ? (
                      <>
                        {humanize(e.targetType)}{" "}
                        {href ? (
                          <Link href={href} className="text-xs text-brand-600 hover:underline">
                            {e.targetId?.slice(0, 8)}
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-400">{e.targetId?.slice(0, 8)}</span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-xs text-ink-500">{e.ip ?? "—"}</td>
                  <td>{e.before || e.after ? <JsonDetails label="Show" value={{ before: e.before ?? undefined, after: e.after ?? undefined }} /> : <span className="text-ink-400">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
      <AdminPagination base="/admin/audit" params={f} page={data.page} pageCount={data.pageCount} />
    </>
  );
}
