import Link from "next/link";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { listTutorQueue } from "@/server/admin";
import { AdminPagination, FilterBar, FilterField, FilterInput, FilterSelect, pageNum, ResultCount, StatusBadge, str, TableWrap, When } from "../_components/table";

export const metadata = { title: "Tutor verification · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminTutorsPage({ searchParams }: PageProps<"/admin/tutors">) {
  await requireAdmin();
  const sp = await searchParams;
  const f = { status: str(sp, "status"), q: str(sp, "q") };
  const data = await listTutorQueue({ ...f, page: pageNum(sp) });
  return (
    <>
      <PageHeader title="Tutor verification" description="Identity documents and qualifications waiting for review. Oldest first." />
      <FilterBar action="/admin/tutors">
        <FilterField label="Queue" name="status">
          <FilterSelect
            name="status"
            value={f.status}
            allLabel="Needs review (pending + needs info)"
            options={[
              { value: "pending", label: "Pending" },
              { value: "needs_info", label: "Needs info" },
              { value: "verified", label: "Verified" },
              { value: "rejected", label: "Rejected" },
              { value: "not_submitted", label: "Not submitted" },
            ]}
          />
        </FilterField>
        <FilterField label="Email or name" name="q">
          <FilterInput name="q" value={f.q} />
        </FilterField>
      </FilterBar>
      <ResultCount total={data.total} page={data.page} pageCount={data.pageCount} />
      {data.rows.length === 0 ? (
        <EmptyState title="Queue is empty" description="No tutor profiles match this filter." />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Tutor</th>
              <th>Identity</th>
              <th>Qualifications</th>
              <th>Listed</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(({ profile, user }) => (
              <tr key={profile.userId}>
                <td>
                  <Link href={`/admin/tutors/${profile.userId}`} className="font-semibold text-brand-600 hover:underline">
                    {user.fullName}
                  </Link>
                  <div className="text-xs text-ink-500">{user.email}</div>
                </td>
                <td>
                  <StatusBadge status={profile.identityStatus} />
                </td>
                <td>
                  <StatusBadge status={profile.qualificationStatus} />
                </td>
                <td>{profile.isListed ? <Badge tone="success">Listed</Badge> : <Badge tone="neutral">Not listed</Badge>}</td>
                <td>
                  <When d={profile.updatedAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <AdminPagination base="/admin/tutors" params={f} page={data.page} pageCount={data.pageCount} />
    </>
  );
}
