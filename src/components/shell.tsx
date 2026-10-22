import Link from "next/link";
import type { ReactNode } from "react";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import type { CurrentUser } from "@/lib/auth";
import { logoutAction } from "@/server/auth-actions";
import { MobileNav, NavLink } from "./nav-client";
import { Avatar, Logo, buttonClass } from "./ui";

export type NavItem = { href: string; label: string; icon?: ReactNode; exact?: boolean };

export const studentNav: NavItem[] = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/tutors", label: "Find tutors" },
  { href: "/dashboard/bookings", label: "My sessions" },
  { href: "/challenges", label: "Daily challenges" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/dashboard/credits", label: "Credits & rewards" },
  { href: "/dashboard/payments", label: "Payments" },
  { href: "/dashboard/referrals", label: "Refer & earn" },
];

export const tutorNav: NavItem[] = [
  { href: "/tutor", label: "Overview", exact: true },
  { href: "/tutor/bookings", label: "Bookings" },
  { href: "/tutor/packages", label: "Packages" },
  { href: "/tutor/availability", label: "Availability & areas" },
  { href: "/tutor/profile", label: "Profile & verification" },
  { href: "/tutor/earnings", label: "Earnings" },
  { href: "/tutor/subscription", label: "Subscription" },
  { href: "/tutor/challenges", label: "My challenges" },
  { href: "/tutor/referrals", label: "Refer & earn" },
];

export const adminNav: NavItem[] = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/tutors", label: "Tutor verification" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/payments", label: "Payments & refunds" },
  { href: "/admin/subscriptions", label: "Subscriptions" },
  { href: "/admin/challenges", label: "Challenge review" },
  { href: "/admin/referrals", label: "Referrals & credits" },
  { href: "/admin/rewards", label: "Rewards" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/settings", label: "Platform settings" },
  { href: "/admin/audit", label: "Audit log" },
];

async function unreadCount(userId: string) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return n;
}

export async function AppHeader({ user }: { user: CurrentUser | null }) {
  const unread = user ? await unreadCount(user.id) : 0;
  const workspaces = user
    ? [
        ...(user.isStudent ? [{ href: "/dashboard", label: "Student" }] : []),
        ...(user.isTutor ? [{ href: "/tutor", label: "Tutor" }] : []),
        ...(user.adminRole ? [{ href: "/admin", label: "Admin" }] : []),
      ]
    : [];
  return (
    <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href={user ? (user.isStudent ? "/dashboard" : user.isTutor ? "/tutor" : "/") : "/"} className="shrink-0" aria-label="TutorLink home">
          <Logo size={34} />
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          <NavLink href="/tutors">Find tutors</NavLink>
          <NavLink href="/challenges">Challenges</NavLink>
          <NavLink href="/leaderboard">Leaderboard</NavLink>
          <NavLink href="/pricing">For tutors</NavLink>
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Link href="/notifications" className="relative rounded-full p-2 text-ink-600 hover:bg-ink-100" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                {unread > 0 && <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
              </Link>
              <div className="hidden items-center gap-2 md:flex">
                {workspaces.length > 1 &&
                  workspaces.map((w) => (
                    <NavLink key={w.href} href={w.href}>
                      {w.label}
                    </NavLink>
                  ))}
                <Link href="/account" className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 hover:bg-ink-100">
                  <Avatar name={user.fullName} src={user.avatarUrl} size={32} />
                  <span className="max-w-[120px] truncate text-sm font-medium">{user.displayName ?? user.fullName.split(" ")[0]}</span>
                </Link>
                <form action={logoutAction}>
                  <button className={buttonClass("ghost", "sm")}>Sign out</button>
                </form>
              </div>
            </>
          ) : (
            <div className="hidden items-center gap-2 md:flex">
              <Link href="/login" className={buttonClass("ghost", "sm")}>
                Sign in
              </Link>
              <Link href="/register" className={buttonClass("primary", "sm")}>
                Get started
              </Link>
            </div>
          )}
          <MobileNav
            signedIn={!!user}
            items={[
              { href: "/tutors", label: "Find tutors" },
              { href: "/challenges", label: "Daily challenges" },
              { href: "/leaderboard", label: "Leaderboard" },
              { href: "/pricing", label: "For tutors" },
              ...(user
                ? [
                    ...(user.isStudent ? studentNav.map((i) => ({ ...i, label: `Student · ${i.label}` })) : []),
                    ...(user.isTutor ? tutorNav.map((i) => ({ ...i, label: `Tutor · ${i.label}` })) : []),
                    ...(user.adminRole ? adminNav.map((i) => ({ ...i, label: `Admin · ${i.label}` })) : []),
                    { href: "/account", label: "Account settings" },
                  ]
                : [
                    { href: "/login", label: "Sign in" },
                    { href: "/register", label: "Create account" },
                  ]),
            ]}
            logout={logoutAction}
          />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-ink-100 bg-ink-50">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo size={30} />
          <p className="mt-3 max-w-sm text-sm text-ink-500">
            Trusted tutors near you, and online. TutorLink is built in Nigeria for students, parents and tutors who take learning seriously.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-ink-900">Students</h3>
          <ul className="mt-3 space-y-2 text-sm text-ink-600">
            <li><Link href="/tutors" className="hover:text-brand-600">Find a tutor</Link></li>
            <li><Link href="/challenges" className="hover:text-brand-600">Daily challenges</Link></li>
            <li><Link href="/leaderboard" className="hover:text-brand-600">Leaderboard &amp; rewards</Link></li>
            <li><Link href="/how-rewards-work" className="hover:text-brand-600">How rewards work</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-ink-900">Tutors &amp; legal</h3>
          <ul className="mt-3 space-y-2 text-sm text-ink-600">
            <li><Link href="/pricing" className="hover:text-brand-600">Plans &amp; commissions</Link></li>
            <li><Link href="/register?as=tutor" className="hover:text-brand-600">Become a tutor</Link></li>
            <li><Link href="/terms" className="hover:text-brand-600">Terms of service</Link></li>
            <li><Link href="/privacy" className="hover:text-brand-600">Privacy notice (NDPA)</Link></li>
            <li><Link href="/safety" className="hover:text-brand-600">Safety &amp; reporting</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ink-100 py-4 text-center text-xs text-ink-400">© {new Date().getFullYear()} TutorLink. All rights reserved.</div>
    </footer>
  );
}

/** Two-column workspace layout with a role sidebar (collapses to a scrollable tab bar on mobile). */
export function Workspace({ nav, children, title }: { nav: NavItem[]; children: ReactNode; title: string }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
      <aside className="lg:w-60 lg:shrink-0" aria-label={`${title} navigation`}>
        <p className="mb-2 hidden text-xs font-semibold uppercase tracking-wide text-ink-400 lg:block">{title}</p>
        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:px-0 lg:pb-0">
          {nav.map((item) => (
            <NavLink key={item.href} href={item.href} exact={item.exact} className="shrink-0">
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
