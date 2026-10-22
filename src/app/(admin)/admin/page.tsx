import Link from "next/link";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { bookingsPerDay, overviewStats, recentAudit } from "@/server/admin";
import { humanize } from "./_components/labels";
import { AuditTrail, StatusBadge } from "./_components/table";

export const metadata = { title: "Admin overview" };
export const dynamic = "force-dynamic";

const LEDGER_KINDS = ["payment_received", "processing_fee", "platform_commission", "tutor_earning", "refund", "payout"] as const;

function BookingsChart({ data }: { data: { day: string; n: number }[] }) {
  const w = 560;
  const h = 160;
  const pad = { l: 28, r: 8, t: 10, b: 28 };
  const max = Math.max(1, ...data.map((d) => d.n));
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const bw = innerW / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={`Bookings per day for the last ${data.length} days`}>
      <title>Bookings per day</title>
      {[0, 0.5, 1].map((f) => {
        const y = pad.t + innerH - f * innerH;
        return (
          <g key={f}>
            <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} className="stroke-ink-100" strokeWidth="1" />
            <text x={pad.l - 6} y={y + 4} textAnchor="end" fontSize="10" className="fill-ink-500">
              {Math.round(f * max)}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const bh = (d.n / max) * innerH;
        const x = pad.l + i * bw + bw * 0.15;
        const y = pad.t + innerH - bh;
        return (
          <g key={d.day}>
            <rect x={x} y={y} width={bw * 0.7} height={bh} rx="3" className="fill-brand-600">
              <title>{`${d.day}: ${d.n} booking${d.n === 1 ? "" : "s"}`}</title>
            </rect>
            {(i % 2 === 0 || data.length <= 7) && (
              <text x={x + bw * 0.35} y={h - 10} textAnchor="middle" fontSize="10" className="fill-ink-500">
                {d.day.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default async function AdminOverviewPage() {
  await requireAdmin();
  const [s, perDay, trail] = await Promise.all([overviewStats(), bookingsPerDay(14), recentAudit(10)]);
  const queue: { label: string; n: number; href: string }[] = [
    { label: "Identity reviews", n: s.tutors.identityPending, href: "/admin/tutors" },
    { label: "Qualification reviews", n: s.tutors.qualificationPending, href: "/admin/tutors" },
    { label: "Challenges in review", n: s.challengesInReview, href: "/admin/challenges" },
    { label: "Open reports", n: s.openReports, href: "/admin/reports" },
    { label: "Refunds requested", n: s.refundsRequested, href: "/admin/payments/refunds" },
    { label: "Payouts requested", n: s.payoutsRequested, href: "/admin/payments/payouts?status=requested" },
    { label: "Rewards pending", n: s.rewardsPending, href: "/admin/rewards" },
  ];
  return (
    <>
      <PageHeader title="Overview" description="Platform health at a glance. Numbers are live." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users" value={s.users.total.toLocaleString()} hint={`${s.users.students} students · ${s.users.tutors} tutors · ${s.users.admins} admins${s.users.suspended ? ` · ${s.users.suspended} suspended` : ""}`} />
        <Stat label="Listed tutors" value={s.tutors.listed.toLocaleString()} hint="Visible in search" tone="teal" />
        <Stat label="Bookings (30 days)" value={s.bookings30.toLocaleString()} hint={s.bookingsByStatus.map((b) => `${b.n} ${humanize(b.status).toLowerCase()}`).join(" · ") || "No bookings yet"} tone="brand" />
        <Stat label="Platform commission" value={formatNgn(s.ledger.platform_commission ?? "0")} hint={`Refunds ${formatNgn(s.ledger.refund ?? "0")}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Bookings per day" description="Last 14 days (Africa/Lagos)" />
          <div className="px-5 pb-5">
            <BookingsChart data={perDay} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Work queue" description="Items waiting for a decision" />
          <ul className="divide-y divide-ink-100">
            {queue.map((q) => (
              <li key={q.label}>
                <Link href={q.href} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-ink-50">
                  <span className="text-ink-700">{q.label}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${q.n > 0 ? "bg-warning-100 text-warning-600" : "bg-ink-100 text-ink-500"}`}>{q.n}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Ledger summary" description="Sum of all ledger entries by kind (NGN)" />
          <div className="overflow-x-auto">
            <table className="tl-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {LEDGER_KINDS.map((k) => (
                  <tr key={k}>
                    <td>{humanize(k)}</td>
                    <td className="text-right font-medium tabular-nums">{formatNgn(s.ledger[k] ?? "0")}</td>
                  </tr>
                ))}
                {s.ledger.adjustment && (
                  <tr>
                    <td>Adjustments</td>
                    <td className="text-right font-medium tabular-nums">{formatNgn(s.ledger.adjustment)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="Bookings by status" description="Created in the last 30 days" />
          {s.bookingsByStatus.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-ink-500">No bookings in the last 30 days.</p>
          ) : (
            <ul className="flex flex-wrap gap-2 px-5 pb-5">
              {s.bookingsByStatus.map((b) => (
                <li key={b.status} className="flex items-center gap-2 rounded-full border border-ink-100 px-3 py-1 text-sm">
                  <StatusBadge status={b.status} />
                  <span className="font-semibold">{b.n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Recent audit entries"
          description="Last 10 actions"
          action={
            <Link href="/admin/audit" className="text-sm font-semibold text-brand-600 hover:underline">
              Full log →
            </Link>
          }
        />
        <AuditTrail rows={trail} />
      </Card>
    </>
  );
}
