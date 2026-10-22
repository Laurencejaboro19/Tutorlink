import { AppHeader, SiteFooter, Workspace, tutorNav } from "@/components/shell";
import { requireTutor } from "@/lib/auth";

export default async function TutorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireTutor();
  return (
    <>
      <AppHeader user={user} />
      <Workspace nav={tutorNav} title="Tutor">
        {children}
      </Workspace>
      <SiteFooter />
    </>
  );
}
