import { getCurrentUser } from "@/lib/auth";
import { AppHeader, SiteFooter } from "@/components/shell";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-1 flex-col">{children}</div>
      <SiteFooter />
    </>
  );
}
