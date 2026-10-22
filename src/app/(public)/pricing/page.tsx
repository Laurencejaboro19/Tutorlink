import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { subscriptionPlans } from "@/db/schema";
import { buttonClass, PageHeader } from "@/components/ui";
import { formatNgn } from "@/lib/money";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Plans & commissions for tutors" };

export default async function PricingPage() {
  const plans = await db.select().from(subscriptionPlans).orderBy(asc(subscriptionPlans.sortOrder));
  const freeLimit = await getSetting("plans.free_max_published_packages");
  const features: Record<string, string[]> = {
    free: ["Core marketplace listing", `Up to ${freeLimit} published packages`, "Bookings, availability & reviews", "Daily challenge creation (reviewed)"],
    premium: ["Everything in Free", "Unlimited packages", "Higher visibility eligibility & profile boost", "Teaching & earnings analytics"],
    premium_plus: ["Everything in Premium", "Enhanced promotional placement (labelled)", "Priority verification review", "Lowest commission on every session"],
  };
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="For tutors"
        title="Simple plans. Commission goes down as you grow."
        description="Pay nothing to start. Paid plans lower the platform commission on every session and unlock promotional tools — they never override performance-based ranking."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        {plans.map((p) => (
          <div key={p.code} className={`tl-card flex flex-col p-6 ${p.code === "premium" ? "border-brand-300 ring-2 ring-brand-100" : ""}`}>
            <h2 className="text-lg font-semibold text-ink-900">{p.name}</h2>
            <p className="mt-2 text-3xl font-bold text-ink-900">
              {formatNgn(p.monthlyFeeNgn)}
              <span className="text-sm font-normal text-ink-500">/month</span>
            </p>
            <p className="mt-1 text-sm font-semibold text-teal-700">{Number(p.commissionPct)}% platform commission</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-ink-600">
              {(features[p.code] ?? []).map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-teal-500" aria-hidden="true">
                    ✓
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            <Link href={p.code === "free" ? "/register?as=tutor" : `/tutor/subscription?plan=${p.code}`} className={buttonClass(p.code === "premium" ? "primary" : "outline", "md", "mt-6")}>
              {p.code === "free" ? "Start free" : `Choose ${p.name}`}
            </Link>
          </div>
        ))}
      </div>
      <div className="tl-card mt-10 p-6">
        <h2 className="text-lg font-semibold">Worked example: a ₦10,000 session</h2>
        <table className="tl-table mt-4">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Platform commission</th>
              <th>Tutor allocation</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => {
              const c = (10000 * Number(p.commissionPct)) / 100;
              return (
                <tr key={p.code}>
                  <td>{p.name}</td>
                  <td>{formatNgn(c)}</td>
                  <td>{formatNgn(10000 - c)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-4 text-sm text-ink-500">
          Payment-processing fees are absorbed on the platform side of the commission. Refunds return the student&apos;s payment and reverse the matching commission and earning entries; disputed sessions are held until resolved. Historical sessions keep the commission rate that applied when they were booked, even if you change plan later. Subscriptions renew only after a verified payment and can be cancelled at any time; cancelling keeps paid benefits until the period ends and never deletes your packages or history.
        </p>
      </div>
    </div>
  );
}
