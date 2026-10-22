import { AppHeader, SiteFooter } from "@/components/shell";
import { requireStudent } from "@/lib/auth";

export default async function BookLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStudent();
  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <SiteFooter />
    </>
  );
}
