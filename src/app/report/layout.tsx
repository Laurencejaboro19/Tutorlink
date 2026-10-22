import { AppHeader, SiteFooter } from "@/components/shell";
import { requireUser } from "@/lib/auth";

export default async function ReportLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser({ allowIncompleteOnboarding: true });
  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <SiteFooter />
    </>
  );
}
