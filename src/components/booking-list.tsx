import Link from "next/link";
import { Badge, EmptyState, Pagination, buttonClass } from "./ui";
import { formatNgn } from "@/lib/money";
import { formatDateTime, formatTime } from "@/lib/time";
import { bookingStatus, type BookingTab } from "@/server/booking-queries";

export type BookingListRow = {
  id: string;
  status: string;
  format: "physical" | "online";
  startsAt: Date;
  endsAt: Date;
  priceNgn: string;
  amountDueNgn: string;
  paymentId: string | null;
  tutorFirstResponseAt: Date | null;
  packageTitle: string;
  subject: string;
  counterpart: string;
};

export function BookingTabs({ tabs, active, base }: { tabs: { key: BookingTab; label: string; count?: number }[]; active: BookingTab; base: string }) {
  return (
    <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-ink-100 px-4" aria-label="Booking views">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}?tab=${t.key}`}
          aria-current={t.key === active ? "page" : undefined}
          className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${t.key === active ? "border-brand-600 text-brand-700" : "border-transparent text-ink-600 hover:text-ink-900"}`}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 text-xs text-ink-700">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function BookingList({
  rows,
  page,
  pageCount,
  hrefFor,
  detailBase,
  side,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  rows: BookingListRow[];
  page: number;
  pageCount: number;
  hrefFor: (p: number) => string;
  detailBase: string;
  side: "student" | "tutor";
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  const now = new Date().getTime();
  return (
    <>
      <ul className="space-y-3" aria-label="Bookings">
        {rows.map((b) => {
          const st = bookingStatus(b.status);
          const hint =
            side === "student" && b.status === "pending_payment"
              ? "Payment needed"
              : side === "tutor" && b.status === "confirmed" && !b.tutorFirstResponseAt
                ? "Awaiting your acknowledgement"
                : b.status === "confirmed" && b.endsAt.getTime() < now
                  ? "Session ended — mark completed or report a problem"
                  : null;
          return (
            <li key={b.id} className="tl-card p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <Badge tone="neutral">{b.format === "physical" ? "In person" : "Online"}</Badge>
                  </div>
                  <p className="mt-2 font-semibold text-ink-900">
                    <Link href={`${detailBase}/${b.id}`} className="hover:text-brand-600">
                      {b.packageTitle}
                    </Link>
                  </p>
                  <p className="text-sm text-ink-600">
                    {b.subject} · with {b.counterpart}
                  </p>
                  <p className="mt-1 text-sm text-ink-700">
                    <time dateTime={b.startsAt.toISOString()}>{formatDateTime(b.startsAt)}</time> – {formatTime(b.endsAt)}
                  </p>
                  {hint && <p className="mt-1 text-xs font-semibold text-warning-600">{hint}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
                  <span className="text-sm font-semibold text-ink-900">{formatNgn(side === "student" ? b.amountDueNgn : b.priceNgn)}</span>
                  {side === "student" && b.status === "pending_payment" && b.paymentId ? (
                    <a href={`/pay/${b.paymentId}`} className={buttonClass("primary", "sm")}>
                      Pay now
                    </a>
                  ) : (
                    <Link href={`${detailBase}/${b.id}`} className={buttonClass("outline", "sm")}>
                      Details
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Pagination page={page} pageCount={pageCount} hrefFor={hrefFor} />
    </>
  );
}
