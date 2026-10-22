import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { AppHeader, SiteFooter } from "@/components/shell";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser({ allowIncompleteOnboarding: true });
  const rows = await db.query.notifications.findMany({ where: eq(notifications.userId, user.id), orderBy: desc(notifications.createdAt), limit: 100 });
  // Mark as read on view
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <PageHeader title="Notifications" description="Bookings, payments, challenge results, rewards and account updates." />
        {rows.length === 0 ? (
          <EmptyState title="Nothing yet" description="When something happens on your account, you will see it here." />
        ) : (
          <ul className="tl-card divide-y divide-ink-100">
            {rows.map((n) => (
              <li key={n.id} className={`px-5 py-4 ${n.readAt ? "" : "bg-brand-50/40"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink-900">{n.title}</p>
                    <p className="mt-0.5 text-sm text-ink-600">{n.body}</p>
                  </div>
                  <time className="shrink-0 text-xs text-ink-400" dateTime={n.createdAt.toISOString()}>
                    {n.createdAt.toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                  </time>
                </div>
                {n.href && (
                  <Link href={n.href} className="mt-2 inline-block text-sm font-semibold text-brand-600 hover:underline">
                    View →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
