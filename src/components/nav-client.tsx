"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cn, buttonClass } from "./ui";

export function NavLink({ href, children, exact, className }: { href: string; children: ReactNode; exact?: boolean; className?: string }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function MobileNav({ items, signedIn, logout }: { items: { href: string; label: string }[]; signedIn: boolean; logout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-[var(--radius-md)] p-2 text-ink-700 hover:bg-ink-100"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "Close menu" : "Open menu"}
      >
        {open ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        )}
      </button>
      {open && (
        <div id="mobile-menu" className="fixed inset-x-0 top-16 bottom-0 z-50 overflow-y-auto border-t border-ink-100 bg-white px-4 py-4">
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            {items.map((i) => (
              <Link key={i.href + i.label} href={i.href} className="rounded-[var(--radius-md)] px-3 py-3 text-base font-medium text-ink-800 hover:bg-ink-100">
                {i.label}
              </Link>
            ))}
            {signedIn && (
              <form action={logout} className="mt-3">
                <button className={buttonClass("outline", "md", "w-full")}>Sign out</button>
              </form>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}
