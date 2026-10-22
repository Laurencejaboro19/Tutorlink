import Link from "next/link";
import { and, count, desc, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { creditEntries } from "@/db/schema";
import { Alert, Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader, Pagination, Stat, type Tone } from "@/components/ui";
import { requireStudent } from "@/lib/auth";
import { formatNgn, toKobo } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/time";
import { creditBalance } from "@/server/credits";
import { REWARD_STATUS_LABEL, userRewards } from "@/server/leaderboards";

export const metadata = { title: "Credits & rewards" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const TYPE_LABEL: Record<typeof creditEntries.$inferSelect.type, string> = {
  referral: "Referral",
  challenge_reward: "Challenge reward",
  leaderboard_reward: "Leaderboard reward",
  promotional: "Promotion",
  redemption: "Applied to booking",
  reversal: "Reversal",
  adjustment: "Adjustment",
};

const CREDIT_STATUS_LABEL: Record<typeof creditEntries.$inferSelect.status, string> = {
  pending: "Pending",
  available: "Available",
  redeemed: "Redeemed",
  reversed: "Reversed",
  expired: "Expired",
};

function statusTone(s: typeof creditEntries.$inferSelect.status): Tone {
  return s === "available" ? "success" : s === "pending" ? "warning" : s === "reversed" || s === "expired" ? "danger" : "neutral";
}

function rewardTone(status: keyof typeof REWARD_STATUS_LABEL): Tone {
  if (status === "credited" || status === "paid") return "success";
  if (status === "rejected" || status === "failed" || status === "reversed") return "danger";
  if (status === "approved" || status === "payout_initiated") return "brand";
  return "warning";
}

export default async function CreditsPage({ searchParams }: PageProps<"/dashboard/credits">) {
  const user = await requireStudent();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 86_400_000);
  const [balance, settings, rows, [{ n: total }], expiring, rewards] = await Promise.all([
    creditBalance(user.id),
    getSettings(["credits.max_redeem_pct_of_booking", "referral.credit_expiry_days", "leaderboard.reward_ngn"]),
    db.select().from(creditEntries).where(eq(creditEntries.userId, user.id)).orderBy(desc(creditEntries.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(creditEntries).where(eq(creditEntries.userId, user.id)),
    db
      .select({ id: creditEntries.id, amountNgn: creditEntries.amountNgn, expiresAt: creditEntries.expiresAt, reason: creditEntries.reason })
      .from(creditEntries)
      .where(and(eq(creditEntries.userId, user.id), eq(creditEntries.status, "available"), isNotNull(creditEntries.expiresAt), lt(creditEntries.expiresAt, soon), gt(creditEntries.expiresAt, now), sql`${creditEntries.amountNgn} > 0`))
      .orderBy(creditEntries.expiresAt),
    userRewards(user.id),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const earned = rows.filter((r) => toKobo(r.amountNgn) > 0n && r.status === "available").length;

  return (
    <>
      <PageHeader eyebrow="Student" title="Credits & rewards" description="Platform credit from referrals and leaderboard rewards. Credits are not cash: they can only be applied to bookings and cannot be withdrawn." />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Available credit" value={formatNgn(balance)} hint={`Covers up to ${settings["credits.max_redeem_pct_of_booking"]}% of any booking`} tone="teal" />
        <Stat label="Entries" value={total} hint={`${earned} available on this page`} />
        <Stat label="Rewards" value={rewards.length} hint="Leaderboard rewards received" />
      </div>

      {expiring.length > 0 && (
        <Alert tone="warning" title="Credit expiring soon" className="mb-6">
          <ul className="list-disc pl-5">
            {expiring.map((e) => (
              <li key={e.id}>
                {formatNgn(e.amountNgn)} ({e.reason}) expires on {formatDate(e.expiresAt!)}.
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Use it on a booking before then —{" "}
            <Link href="/tutors" className="font-semibold underline">
              find a tutor
            </Link>
            .
          </p>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader title="How credits work" />
        <ul className="space-y-1 px-5 pb-5 text-sm text-ink-700">
          <li>• At checkout, tick “use my credits” and up to {settings["credits.max_redeem_pct_of_booking"]}% of the session price is covered by credit; the rest is paid through Flutterwave.</li>
          <li>• Referral credits expire {settings["referral.credit_expiry_days"]} days after they are earned; leaderboard credits follow the same rule.</li>
          <li>• If a booking is cancelled or refunded, the credit you applied comes back to your balance.</li>
          <li>• Credits are not cash and cannot be transferred or withdrawn. Rewards found to be fraudulent are reversed.</li>
          <li>
            •{" "}
            <Link href="/how-rewards-work" className="font-semibold text-brand-600 hover:underline">
              Full rules
            </Link>
          </li>
        </ul>
      </Card>

      <Card className="mb-6">
        <CardHeader title="Leaderboard rewards" description={`Top finishers each cycle receive ₦${Number(settings["leaderboard.reward_ngn"]).toLocaleString()} as cash (after a paid session in the cycle) or credit.`} />
        <div className="px-5 pb-5">
          {rewards.length === 0 ? (
            <EmptyState
              title="No rewards yet"
              description="Finish in the top of the nationwide leaderboard with enough attempts to earn a reward."
              action={
                <ButtonLink href="/leaderboard" size="sm" variant="outline">
                  See the leaderboard
                </ButtonLink>
              }
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {rewards.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-medium text-ink-900">
                      Rank #{r.rank} · cycle {formatDate(r.cycleStartsAt)} – {formatDate(new Date(r.cycleEndsAt.getTime() - 1))}
                    </p>
                    <p className="text-xs text-ink-500">
                      {formatNgn(r.amountNgn)} {r.kind === "cash" ? "cash" : "credit"}
                      {r.eligibilityNote ? ` · ${r.eligibilityNote}` : ""}
                      {r.reviewNote ? ` · ${r.reviewNote}` : ""}
                    </p>
                  </div>
                  <Badge tone={rewardTone(r.status)}>{REWARD_STATUS_LABEL[r.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Credit ledger" description={`${total} entr${total === 1 ? "y" : "ies"}`} />
        <div className="px-5 pb-5">
          {rows.length === 0 ? (
            <EmptyState
              title="No credit activity yet"
              description="Refer a friend or climb the leaderboard to earn your first credit."
              action={
                <ButtonLink href="/dashboard/referrals" size="sm">
                  Refer a friend
                </ButtonLink>
              }
            />
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="tl-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Reason</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const neg = toKobo(r.amountNgn) < 0n;
                    return (
                      <tr key={r.id}>
                        <td className="text-sm text-ink-700">{formatDateTime(r.createdAt)}</td>
                        <td className="text-sm text-ink-900">{TYPE_LABEL[r.type]}</td>
                        <td className="text-sm text-ink-700">{r.reason}</td>
                        <td className={`text-sm font-semibold ${neg ? "text-danger-600" : "text-success-600"}`}>
                          {neg ? "−" : "+"}
                          {formatNgn(r.amountNgn.replace("-", ""))}
                        </td>
                        <td>
                          <Badge tone={statusTone(r.status)}>{CREDIT_STATUS_LABEL[r.status]}</Badge>
                        </td>
                        <td className="text-sm text-ink-500">{r.expiresAt ? formatDate(r.expiresAt) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pageCount={pageCount} hrefFor={(p) => `/dashboard/credits?page=${p}`} />
        </div>
      </Card>
    </>
  );
}
