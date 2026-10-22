import { AppHeader, SiteFooter, Workspace, studentNav } from "@/components/shell";
import { requireStudent } from "@/lib/auth";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStudent();
  return (
    <>
      <AppHeader user={user} />
      <Workspace nav={studentNav} title="Student">
        {children}
      </Workspace>
      <SiteFooter />
    </>
  );
}
