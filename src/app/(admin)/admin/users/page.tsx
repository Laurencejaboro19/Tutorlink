import Link from "next/link";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { listUsers } from "@/server/admin";
import { ROLE_TONE } from "../_components/labels";
import { AdminPagination, FilterBar, FilterField, FilterInput, FilterSelect, pageNum, ResultCount, StatusBadge, str, TableWrap, When } from "../_components/table";

export const metadata = { title: "Users · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  await requireAdmin();
  const sp = await searchParams;
  const f = { q: str(sp, "q"), role: str(sp, "role"), status: str(sp, "status") };
  const data = await listUsers({ ...f, page: pageNum(sp) });
  return (
    <>
      <PageHeader title="Users" description="Search accounts, inspect activity and take moderation or finance actions." />
      <FilterBar action="/admin/users">
        <FilterField label="Email or name" name="q">
          <FilterInput name="q" value={f.q} placeholder="ada@example.com" />
        </FilterField>
        <FilterField label="Role" name="role">
          <FilterSelect name="role" value={f.role} options={[{ value: "student", label: "Students" }, { value: "tutor", label: "Tutors" }, { value: "admin", label: "Admins" }]} />
        </FilterField>
        <FilterField label="Status" name="status">
          <FilterSelect name="status" value={f.status} options={[{ value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "deleted", label: "Deleted" }]} />
        </FilterField>
      </FilterBar>
      <ResultCount total={data.total} page={data.page} pageCount={data.pageCount} />
      {data.rows.length === 0 ? (
        <EmptyState title="No users match" description="Try a different search or clear the filters." />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>User</th>
              <th>Roles</th>
              <th>Status</th>
              <th>Onboarding</th>
              <th>Joined</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/admin/users/${u.id}`} className="font-semibold text-brand-600 hover:underline">
                    {u.fullName}
                  </Link>
                  <div className="text-xs text-ink-500">{u.email}</div>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.isStudent && <Badge tone="brand">Student</Badge>}
                    {u.isTutor && <Badge tone="teal">Tutor</Badge>}
                    {u.adminRole && <Badge tone={ROLE_TONE[u.adminRole]}>Admin · {u.adminRole}</Badge>}
                  </div>
                </td>
                <td>
                  <StatusBadge status={u.status} />
                </td>
                <td className="text-ink-600">{u.onboardingStep.replaceAll("_", " ")}</td>
                <td>
                  <When d={u.createdAt} />
                </td>
                <td>
                  <When d={u.lastSeenAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <AdminPagination base="/admin/users" params={f} page={data.page} pageCount={data.pageCount} />
    </>
  );
}
