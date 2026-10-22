import Link from "next/link";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { Alert, Badge, Card, CardHeader, Pagination, PageHeader, Stat, type Tone } from "@/components/ui";
import { requireTutor } from "@/lib/auth";
import { formatNgn, fromKobo, ngn, percentOf, subNgn, toKobo } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { payoutsEnabled } from "@/server/flutterwave";
import type { LedgerKind } from "@/server/ledger";
import { NIGERIAN_BANKS, getBankAccountMasked, listTutorPayouts, payoutStatusLabel, requestableBalance, type PayoutStatus } from "@/server/payouts";
import { getActivePlan, listPlans } from "@/server/plans";
import { BankDetailsForm, CancelPayoutForm, RequestPayoutForm } from "./payout-forms";

export const metadata = { title: "Earnings & payouts" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function kindLabel(kind: LedgerKind): { label: string; tone: Tone } {
  switch (kind) {
    case "tutor_earning":
      return { label: "Session earning", tone: "success" };
    case "refund":
      return { label: "Refund reversal", tone: "danger" };
    case "payout":
      return { label: "Payout", tone: "brand" };
    case "adjustment":
      return { label: "Adjustment", tone: "warning" };
    case "payment_received":
      return { label: "Payment received", tone: "neutral" };
    case "processing_fee":
      return { label: "Processing fee", tone: "neutral" };
    case "platform_commission":
      return { label: "Platform commission", tone: "neutral" };
  }
}

function payoutTone(s: PayoutStatus): Tone {
  return s === "completed" ? "success" : s === "failed" ? "danger" : s === "cancelled" ? "neutral" : s === "requested" ? "warning" : "brand";
}

function SignedAmount({ amount }: { amount: string }) {
  const kobo = toKobo(amount);
  const neg = kobo < 0n;
  const abs = fromKobo(neg ? -kobo : kobo);
  return (
    <span className={neg ? "font-semibold text-danger-600" : "font-semibold text-success-600"}>
      <span className="sr-only">{neg ? "minus " : "plus "}</span>
      {neg ? "−" : "+"}
      {formatNgn(abs)}
    </span>
  );
}

export default async function EarningsPage({ searchParams }: PageProps<"/tutor/earnings">) {
  const user = await requireTutor();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const payoutPage = Math.max(1, Number(sp.ppage ?? 1) || 1);

  const [balances, bank, plans, { plan: currentPlan }, minPayout, requireApproval, payoutList] = await Promise.all([
    requestableBalance(user.id),
    getBankAccountMasked(user.id),
    listPlans(),
    getActivePlan(user.id),
    getSetting("payouts.min_amount_ngn"),
    getSetting("payouts.require_admin_approval"),
    listTutorPayouts(user.id, { page: payoutPage, pageSize: 10 }),
  ]);

  const tutorKinds: LedgerKind[] = ["tutor_earning", "refund", "payout", "adjustment"];
  const monthExpr = sql<string>`to_char(${ledgerEntries.createdAt} at time zone 'Africa/Lagos', 'YYYY-MM')`;
  const [entries, [{ n: total }], months] = await Promise.all([
    db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.tutorId, user.id), inArray(ledgerEntries.kind, tutorKinds)))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(ledgerEntries).where(and(eq(ledgerEntries.tutorId, user.id), inArray(ledgerEntries.kind, tutorKinds))),
    db
      .select({
        month: monthExpr,
        earned: sql<string>`coalesce(sum(case when ${ledgerEntries.kind} = 'tutor_earning' then ${ledgerEntries.amountNgn} else 0 end), 0)`,
        reversed: sql<string>`coalesce(sum(case when ${ledgerEntries.kind} = 'refund' then ${ledgerEntries.amountNgn} else 0 end), 0)`,
        sessions: sql<number>`count(*) filter (where ${ledgerEntries.kind} = 'tutor_earning')`,
      })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.tutorId, user.id), inArray(ledgerEntries.kind, ["tutor_earning", "refund"])))
      .groupBy(monthExpr)
      .orderBy(desc(monthExpr))
      .limit(12),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const minNgn = ngn(minPayout);
  const canRequest = Boolean(bank) && toKobo(balances.requestable) >= toKobo(minNgn);
  const transfersLive = payoutsEnabled();

  return (
    <>
      <PageHeader eyebrow="Tutor" title="Earnings & payouts" description="Every naira here comes from the ledger: earnings accrue when a booking is confirmed, reversals land when a session is refunded, and payouts are deducted only when finance approves them." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Lifetime earnings" value={formatNgn(balances.lifetimeEarnings)} hint="Tutor allocation on confirmed sessions" />
        <Stat label="Refunded" value={formatNgn(balances.refunded)} hint="Earnings reversed by refunds" />
        <Stat label="Paid out" value={formatNgn(balances.paidOut)} hint="Approved or completed payouts" />
        <Stat label="Available" value={formatNgn(balances.available)} tone="teal" hint={toKobo(balances.pendingRequested) > 0n ? `${formatNgn(balances.pendingRequested)} awaiting approval` : "Ready to request"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Ledger */}
        <Card className="lg:col-span-3">
          <CardHeader title="Ledger" description={`${total} entr${total === 1 ? "y" : "ies"} on your account`} />
          <div className="px-5 pb-5">
            {entries.length === 0 ? (
              <p className="text-sm text-ink-500">Nothing yet. Your first confirmed booking will appear here as a session earning.</p>
            ) : (
              <div className="-mx-5 overflow-x-auto px-5">
                <table className="tl-table min-w-[560px]">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Details</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const k = kindLabel(e.kind);
                      return (
                        <tr key={e.id}>
                          <td>
                            <Badge tone={k.tone}>{k.label}</Badge>
                          </td>
                          <td className="whitespace-nowrap">
                            <SignedAmount amount={e.amountNgn} />
                          </td>
                          <td className="text-sm text-ink-700">
                            {e.memo && <span className="block">{e.memo}</span>}
                            {e.bookingId && (
                              <Link href={`/tutor/bookings/${e.bookingId}`} className="text-xs text-brand-600 underline-offset-2 hover:underline">
                                View booking
                              </Link>
                            )}
                            {e.payoutId && <span className="block text-xs text-ink-400">Payout {e.payoutId.slice(0, 8)}</span>}
                          </td>
                          <td className="whitespace-nowrap text-xs text-ink-500">{formatDateTime(e.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={page} pageCount={pageCount} hrefFor={(p) => `/tutor/earnings?page=${p}${payoutPage > 1 ? `&ppage=${payoutPage}` : ""}`} />
          </div>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          {/* By month */}
          <Card>
            <CardHeader title="Earnings by month" description="Net of refund reversals (last 12 months)" />
            <div className="px-5 pb-5">
              {months.length === 0 ? (
                <p className="text-sm text-ink-500">No earnings recorded yet.</p>
              ) : (
                <table className="tl-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Sessions</th>
                      <th>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((m) => {
                      const net = fromKobo(toKobo(m.earned) + toKobo(m.reversed));
                      const [y, mo] = m.month.split("-");
                      const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-NG", { month: "short", year: "numeric" });
                      return (
                        <tr key={m.month}>
                          <td className="font-medium">{label}</td>
                          <td>{Number(m.sessions)}</td>
                          <td className="whitespace-nowrap font-semibold">{formatNgn(net)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          {/* Commission explainer */}
          <Card>
            <CardHeader title="Your commission rate" description={`You are on ${currentPlan.name}: ${Number(currentPlan.commissionPct)}% of each session goes to TutorLink.`} />
            <div className="px-5 pb-5">
              <table className="tl-table">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Commission</th>
                    <th>You keep of ₦10,000</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => {
                    const keep = subNgn("10000.00", percentOf("10000.00", p.commissionPct));
                    return (
                      <tr key={p.code} className={p.code === currentPlan.code ? "bg-teal-50" : undefined}>
                        <td className="font-medium">
                          {p.name}
                          {p.code === currentPlan.code && <span className="ml-1 text-xs text-teal-700">(you)</span>}
                        </td>
                        <td>{Number(p.commissionPct)}%</td>
                        <td className="font-semibold">{formatNgn(keep)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-ink-500">
                The rate is locked when a student books, so changing plan never alters past sessions. Processing fees are absorbed on the platform side.{" "}
                <Link href="/tutor/subscription" className="text-brand-600 underline-offset-2 hover:underline">
                  Change plan
                </Link>
              </p>
            </div>
          </Card>
        </div>
      </div>

      {/* Payouts */}
      <h2 className="mb-3 mt-8 text-lg font-semibold text-ink-900">Payouts</h2>
      {!transfersLive && (
        <Alert tone="warning" className="mb-4" title="Bank transfers are not switched on for this deployment">
          You can save bank details and submit payout requests, and finance can approve them, but no money moves until the operator enables transfers (PAYOUTS_ENABLED). Approved payouts wait in the queue.
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Bank details" description={bank ? `${bank.bankName} · ••••••${bank.accountLast4} · ${bank.accountName}` : "Where payouts are sent. Required before you can request one."} />
          <div className="px-5 pb-5">
            <BankDetailsForm banks={NIGERIAN_BANKS} current={bank ? { bankCode: bank.bankCode, accountLast4: bank.accountLast4, accountName: bank.accountName } : null} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Request a payout" description={`Minimum ${formatNgn(minNgn)}. You can request up to ${formatNgn(balances.requestable)}.`} />
          <div className="px-5 pb-5">
            <RequestPayoutForm
              requestable={balances.requestable}
              min={minNgn}
              disabledReason={!bank ? "Add your bank details first." : toKobo(balances.requestable) < toKobo(minNgn) ? `Your requestable balance (${formatNgn(balances.requestable)}) is below the ${formatNgn(minNgn)} minimum.` : !canRequest ? "Payouts are unavailable right now." : undefined}
            />
            <div className="mt-4 rounded-[var(--radius-md)] bg-ink-50 p-3 text-xs text-ink-600">
              <p className="font-semibold text-ink-700">What happens next</p>
              <ol className="mt-1 list-decimal space-y-1 pl-4">
                <li>{requireApproval ? "The finance team reviews your request. Your balance is not touched until they approve it." : "Your request is queued for processing."}</li>
                <li>On approval the amount is deducted from your available balance and a bank transfer is sent through Flutterwave.</li>
                <li>If the transfer fails, the amount is returned to your balance automatically and you are notified.</li>
              </ol>
              <p className="mt-2">You can withdraw a request any time before it is approved.</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Payout history" description={`${payoutList.total} request${payoutList.total === 1 ? "" : "s"}`} />
        <div className="px-5 pb-5">
          {payoutList.rows.length === 0 ? (
            <p className="text-sm text-ink-500">No payout requests yet.</p>
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="tl-table min-w-[600px]">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Requested</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {payoutList.rows.map((p) => (
                    <tr key={p.id}>
                      <td className="font-mono text-xs">{p.reference}</td>
                      <td className="whitespace-nowrap font-semibold">{formatNgn(p.amountNgn)}</td>
                      <td>
                        <Badge tone={payoutTone(p.status)}>{payoutStatusLabel(p.status)}</Badge>
                        {p.failureReason && (p.status === "failed" || p.status === "cancelled" || p.status === "approved") && <span className="mt-1 block max-w-xs text-xs text-ink-500">{p.failureReason}</span>}
                      </td>
                      <td className="whitespace-nowrap text-xs text-ink-500">{formatDateTime(p.createdAt)}</td>
                      <td className="text-right">{p.status === "requested" && <CancelPayoutForm payoutId={p.id} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={payoutList.page} pageCount={payoutList.pageCount} hrefFor={(p) => `/tutor/earnings?ppage=${p}${page > 1 ? `&page=${page}` : ""}`} />
        </div>
      </Card>
    </>
  );
}
