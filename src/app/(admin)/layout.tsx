import { AppHeader, Workspace, adminNav } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return (
    <>
      <AppHeader user={user} />
      <Workspace nav={adminNav} title={`Admin · ${user.adminRole}`}>
        {children}
      </Workspace>
    </>
  );
}
