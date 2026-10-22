import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { payments, subscriptions } from "@/db/schema";
import { Alert, Badge, Card, CardHeader, Pagination, PageHeader, type Tone } from "@/components/ui";
import { requireTutor } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/time";
import { flutterwaveConfigured } from "@/server/flutterwave";
import { getActivePlan, listPlans, type PlanCode } from "@/server/plans";
import { CancelPlanForm, StartPlanForm } from "./subscription-forms";

export const metadata = { title: "Subscription" };
export const dynamic = "force-dynamic";

type Sub = typeof subscriptions.$inferSelect;
type SubStatus = Sub["status"];
type SubSource = Sub["source"];

const PAGE_SIZE = 20;
const RANK: Record<PlanCode, number> = { free: 0, premium: 1, premium_plus: 2 };
const RENEW_WINDOW_DAYS = 5;

function statusLabel(s: SubStatus): { label: string; tone: Tone } {
  switch (s) {
    case "active":
      return { label: "Active", tone: "success" };
    case "pending_payment":
      return { label: "Awaiting payment", tone: "warning" };
    case "past_due":
      return { label: "Past due", tone: "danger" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "expired":
      return { label: "Expired", tone: "neutral" };
  }
}

function sourceLabel(s: SubSource) {
  return s === "paid" ? "Paid" : s === "promotional" ? "Reward (promotional)" : "Granted by TutorLink";
}

export default async function SubscriptionPage({ searchParams }: PageProps<"/tutor/subscription">) {
  const user = await requireTutor();
  const sp = await searchParams;
  const preselect = sp.plan === "premium" || sp.plan === "premium_plus" ? sp.plan : null;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const [plans, { plan: currentPlan, subscription: current }, freeLimit, configured] = await Promise.all([listPlans(), getActivePlan(user.id), getSetting("plans.free_max_published_packages"), Promise.resolve(flutterwaveConfigured())]);

  const [history, [{ n: total }]] = await Promise.all([
    db
      .select({ sub: subscriptions, paymentReference: payments.reference, paymentStatus: payments.status })
      .from(subscriptions)
      .leftJoin(payments, eq(payments.id, subscriptions.paymentId))
      .where(eq(subscriptions.tutorId, user.id))
      .orderBy(desc(subscriptions.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.tutorId, user.id)),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const now = new Date().getTime();
  const daysLeft = current ? Math.ceil((current.endsAt.getTime() - now) / 86_400_000) : 0;

  /** Mirrors the rules in server/subscriptions.ts so the button never promises something the service refuses. */
  function decide(code: "premium" | "premium_plus"): { label: string; disabled: boolean; reason?: string; variant: "primary" | "outline" | "secondary" } {
    const plan = plans.find((p) => p.code === code)!;
    if (!current || currentPlan.code === "free") {
      return { label: `Choose ${plan.name}`, disabled: false, reason: "Your 30-day period starts as soon as the payment is verified.", variant: code === "premium" ? "primary" : "secondary" };
    }
    const sameCode = current.planCode === code;
    if (sameCode && current.source === "paid") {
      if (current.cancelAtPeriodEnd || daysLeft <= RENEW_WINDOW_DAYS) {
        return { label: `Renew ${plan.name}`, disabled: false, reason: `Renewing adds 30 days from ${formatDate(current.endsAt)} — you lose nothing.`, variant: "primary" };
      }
      return { label: `Renew ${plan.name}`, disabled: true, reason: `You are already on ${plan.name} until ${formatDate(current.endsAt)}. Renewal opens in the last ${RENEW_WINDOW_DAYS} days of your period, or straight away if you have cancelled renewal.`, variant: "outline" };
    }
    if (sameCode) {
      // Promotional / admin grant of the same plan: buying it starts a paid period now (the grant keeps running in parallel).
      return { label: `Buy ${plan.name}`, disabled: false, reason: `You currently have ${plan.name} as a ${sourceLabel(current.source).toLowerCase()} until ${formatDate(current.endsAt)}. A paid period would start now, not after the grant — wait until it ends to get full value.`, variant: "outline" };
    }
    if (RANK[code] > RANK[current.planCode]) {
      return { label: `Upgrade to ${plan.name}`, disabled: false, reason: current.source === "paid" ? `Starts now. Your remaining ${current.planCode === "premium" ? "Premium" : "Premium+"} days are cancelled — there is no proration or credit for unused time.` : "Starts now, alongside your current promotional access.", variant: code === "premium" ? "primary" : "secondary" };
    }
    // Moving down while a higher paid plan is active.
    return { label: `Switch to ${plan.name}`, disabled: true, reason: `Downgrades take effect at the end of your period: cancel renewal below, then choose ${plan.name} after ${formatDate(current.endsAt)}. Paying now would replace your ${currentPlan.name} period immediately with no refund.`, variant: "outline" };
  }

  const entitlement = (p: (typeof plans)[number]) => ({
    commission: `${Number(p.commissionPct)}%`,
    packages: p.code === "free" ? `Up to ${p.maxPublishedPackages ?? freeLimit} published` : p.maxPublishedPackages === null ? "Unlimited" : `Up to ${p.maxPublishedPackages} published`,
    boost: Number(p.visibilityBoost) > 0 ? `+${Math.round(Number(p.visibilityBoost) * 100)}% visibility${p.profileBoostEligible ? ", profile boost eligible" : ""}` : "None",
    analytics: p.analyticsTools ? "Included" : "Not included",
  });

  return (
    <>
      <PageHeader eyebrow="Tutor" title="Subscription" description="Paid plans lower the commission on every session and unlock promotional tools. Benefits start only after Flutterwave verifies the payment." />

      {!configured && (
        <Alert tone="warning" title="Checkout cannot start on this deployment" className="mb-6">
          Flutterwave keys have not been configured by the operator, so plan payments cannot be started here. Nothing will be charged. Your current plan and history below are still accurate.
        </Alert>
      )}
      {preselect && (
        <Alert tone="brand" className="mb-6">
          You picked <strong>{plans.find((p) => p.code === preselect)?.name ?? preselect}</strong> from the pricing page. Confirm it in the plan comparison below.
        </Alert>
      )}

      {/* Current plan */}
      <Card className="mb-6">
        <CardHeader title="Your current plan" description={current ? "Entitlements are read from this subscription for every booking." : "You are on the Free plan. No subscription row exists until you buy one."} />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Plan</p>
            <p className="mt-1 text-lg font-bold text-ink-900">{currentPlan.name}</p>
            <p className="text-xs text-ink-500">{formatNgn(currentPlan.monthlyFeeNgn)}/month</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Commission</p>
            <p className="mt-1 text-lg font-bold text-teal-700">{Number(currentPlan.commissionPct)}%</p>
            <p className="text-xs text-ink-500">on each session, locked at booking time</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Period</p>
            {current ? (
              <>
                <p className="mt-1 text-sm font-semibold text-ink-900">
                  {formatDate(current.startsAt)} – {formatDate(current.endsAt)}
                </p>
                <p className="text-xs text-ink-500">{daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "Ends today"}</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-500">No end date — Free never expires</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Status</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {current ? (
                <>
                  <Badge tone="success">Active</Badge>
                  <Badge tone={current.source === "paid" ? "brand" : "teal"}>{sourceLabel(current.source)}</Badge>
                  {current.cancelAtPeriodEnd && <Badge tone="warning">Ends at period end</Badge>}
                </>
              ) : (
                <Badge tone="neutral">Free plan</Badge>
              )}
            </div>
            {current?.cancelAtPeriodEnd && <p className="mt-1 text-xs text-ink-500">Renewal cancelled on {current.cancelledAt ? formatDate(current.cancelledAt) : "—"}. Benefits run until {formatDate(current.endsAt)}.</p>}
            {current?.grantReason && <p className="mt-1 text-xs text-ink-500">{current.grantReason}</p>}
          </div>
        </div>
      </Card>

      {/* Plan comparison */}
      <h2 className="mb-3 text-lg font-semibold text-ink-900">Compare plans</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((p) => {
          const e = entitlement(p);
          const isCurrent = currentPlan.code === p.code;
          const highlighted = preselect === p.code;
          return (
            <div key={p.code} id={`plan-${p.code}`} className={`tl-card flex flex-col p-5 ${highlighted ? "border-brand-400 ring-2 ring-brand-100" : isCurrent ? "border-teal-300" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-ink-900">{p.name}</h3>
                  <p className="mt-1 text-2xl font-bold text-ink-900">
                    {formatNgn(p.monthlyFeeNgn)}
                    <span className="text-sm font-normal text-ink-500">/30 days</span>
                  </p>
                </div>
                {isCurrent && <Badge tone="teal">Current</Badge>}
              </div>
              <dl className="mt-4 flex-1 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Commission</dt>
                  <dd className="font-semibold text-ink-900">{e.commission}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Packages</dt>
                  <dd className="text-right font-medium text-ink-900">{e.packages}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Boost</dt>
                  <dd className="text-right font-medium text-ink-900">{e.boost}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Analytics</dt>
                  <dd className="font-medium text-ink-900">{e.analytics}</dd>
                </div>
              </dl>
              <div className="mt-5">
                {p.code === "free" ? (
                  <p className="text-xs text-ink-500">{isCurrent ? "This is your plan. Nothing to pay." : "You return to Free automatically when a paid period ends. Nothing is deleted."}</p>
                ) : (
                  (() => {
                    const d = decide(p.code);
                    return <StartPlanForm plan={p.code} label={d.label} disabled={d.disabled || !configured} reason={!configured && !d.disabled ? "Checkout is unavailable until payments are configured." : d.reason} variant={d.variant} />;
                  })()
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rules */}
      <Card className="mt-6">
        <CardHeader title="How renewals, upgrades and cancellations work" />
        <ul className="space-y-2 px-5 pb-5 text-sm text-ink-700">
          <li>
            <strong>Upgrading</strong> starts a new 30-day period immediately. The old paid period is cancelled and there is <strong>no proration</strong> or credit for unused days.
          </li>
          <li>
            <strong>Renewing the same plan</strong> extends your access by 30 days from your current end date, so paying early never costs you time.
          </li>
          <li>
            <strong>Cancelling</strong> stops renewal only. You keep every benefit until the end date, then return to Free. Nothing is refunded for the remaining days.
          </li>
          <li>
            <strong>Expiry never removes packages.</strong> Packages above the Free limit of {freeLimit} stay published until you unpublish one yourself; you simply cannot publish new ones past the limit.
          </li>
          <li>Each session keeps the commission rate that applied when it was booked, whatever plan you move to later.</li>
          <li>Benefits only start after Flutterwave verifies the payment. A redirect back to TutorLink is not proof of payment.</li>
        </ul>
      </Card>

      {/* Cancel */}
      {current && current.source === "paid" && !current.cancelAtPeriodEnd && (
        <Card className="mt-6">
          <CardHeader title="Cancel renewal" description={`Your ${currentPlan.name} benefits stay active until ${formatDate(current.endsAt)}.`} />
          <div className="px-5 pb-5">
            <CancelPlanForm subscriptionId={current.id} endsAtLabel={formatDate(current.endsAt)} />
          </div>
        </Card>
      )}

      {/* History */}
      <Card className="mt-6">
        <CardHeader title="Subscription history" description={`${total} record${total === 1 ? "" : "s"}`} />
        <div className="px-5 pb-5">
          {history.length === 0 ? (
            <p className="text-sm text-ink-500">No subscriptions yet. You have always been on the Free plan.</p>
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="tl-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Plan</th>
                    <th>Period</th>
                    <th>Source</th>
                    <th>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(({ sub, paymentReference }) => {
                    const s = statusLabel(sub.status);
                    const plan = plans.find((p) => p.code === sub.planCode);
                    return (
                      <tr key={sub.id}>
                        <td>
                          <div className="flex flex-col gap-1">
                            <Badge tone={s.tone}>{s.label}</Badge>
                            {sub.cancelAtPeriodEnd && sub.status === "active" && <span className="text-xs text-ink-500">Won&apos;t renew</span>}
                          </div>
                        </td>
                        <td className="font-medium">{plan?.name ?? sub.planCode}</td>
                        <td className="whitespace-nowrap text-sm">
                          {formatDate(sub.startsAt)} – {formatDate(sub.endsAt)}
                          <span className="block text-xs text-ink-400">created {formatDateTime(sub.createdAt)}</span>
                        </td>
                        <td className="text-sm">{sourceLabel(sub.source)}</td>
                        <td className="text-sm">
                          {sub.paymentId && paymentReference ? (
                            <Link href={`/receipts/${sub.paymentId}`} className="font-mono text-xs text-brand-600 underline-offset-2 hover:underline">
                              {paymentReference}
                            </Link>
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pageCount={pageCount} hrefFor={(p) => `/tutor/subscription?page=${p}${preselect ? `&plan=${preselect}` : ""}`} />
        </div>
      </Card>
    </>
  );
}
