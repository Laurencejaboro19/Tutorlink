import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bookings, packages, payments, refunds, subscriptionPlans, subscriptions, users } from "@/db/schema";
import { Badge, Logo, buttonClass } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { addNgn, formatNgn, subNgn } from "@/lib/money";
import { paymentStatusLabel } from "@/lib/payment-status";
import { formatDateTime } from "@/lib/time";
import { PrintButton } from "./print-button";

export const metadata = { title: "Receipt" };
export const dynamic = "force-dynamic";

/** Printable receipt. Visible to the payer and to admins only. */
export default async function ReceiptPage({ params }: PageProps<"/receipts/[paymentId]">) {
  const user = await requireUser();
  const { paymentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) notFound();
  const payment = await db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!payment) notFound();
  if (payment.userId !== user.id && !user.adminRole) notFound();

  const payer = payment.userId === user.id ? user : await db.query.users.findFirst({ where: eq(users.id, payment.userId) });

  let items: { label: string; detail?: string; amount: string }[] = [];
  let backHref = "/dashboard/payments";
  if (payment.purpose === "booking" && payment.bookingId) {
    const [row] = await db
      .select({ booking: bookings, pkgTitle: packages.title, tutorName: users.fullName })
      .from(bookings)
      .innerJoin(packages, eq(packages.id, bookings.packageId))
      .innerJoin(users, eq(users.id, bookings.tutorId))
      .where(eq(bookings.id, payment.bookingId))
      .limit(1);
    if (row) {
      items.push({ label: row.pkgTitle, detail: `with ${row.tutorName} · ${formatDateTime(row.booking.startsAt)} · ${row.booking.format}`, amount: row.booking.priceNgn });
      if (Number(row.booking.creditAppliedNgn) > 0) items.push({ label: "TutorLink credit applied", amount: `-${row.booking.creditAppliedNgn}` });
      backHref = payment.userId === user.id ? `/dashboard/bookings/${row.booking.id}` : `/admin/bookings/${row.booking.id}`;
    }
  } else if (payment.purpose === "subscription" && payment.subscriptionId) {
    const [row] = await db
      .select({ sub: subscriptions, planName: subscriptionPlans.name })
      .from(subscriptions)
      .innerJoin(subscriptionPlans, eq(subscriptionPlans.code, subscriptions.planCode))
      .where(eq(subscriptions.id, payment.subscriptionId))
      .limit(1);
    if (row) {
      items.push({ label: `${row.planName} tutor plan`, detail: `30 days · ${row.sub.status === "active" || row.sub.status === "expired" || row.sub.status === "cancelled" ? `${formatDateTime(row.sub.startsAt)} – ${formatDateTime(row.sub.endsAt)}` : "period starts on verified payment"}`, amount: payment.amountNgn });
      backHref = payment.userId === user.id ? "/tutor/subscription" : "/admin/subscriptions";
    }
  }
  if (items.length === 0) items = [{ label: payment.purpose === "booking" ? "Tutoring session" : "Tutor plan", amount: payment.amountNgn }];

  const refundRows = await db
    .select()
    .from(refunds)
    .where(and(eq(refunds.paymentId, payment.id), inArray(refunds.status, ["completed", "processing", "approved", "requested"])));
  const refundedTotal = refundRows.filter((r) => r.status === "completed").reduce((acc, r) => addNgn(acc, r.amountNgn), "0.00");
  const status = paymentStatusLabel(payment.status);
  const subtotal = items.reduce((acc, i) => addNgn(acc, i.amount), "0.00");

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 print:max-w-none print:px-0 print:py-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={backHref} className={buttonClass("ghost", "sm")}>
          ← Back
        </Link>
        <PrintButton />
      </div>

      <article className="tl-card p-6 sm:p-8 print:border-0 print:p-0 print:shadow-none" aria-labelledby="receipt-title">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-100 pb-5">
          <div>
            <Logo size={30} />
            <p className="mt-2 text-xs text-ink-500">TutorLink · tutoring marketplace · Nigeria</p>
          </div>
          <div className="text-right">
            <h1 id="receipt-title" className="text-xl font-bold text-ink-900">
              {payment.status === "successful" || payment.status === "refunded" || payment.status === "partially_refunded" ? "Receipt" : "Payment record"}
            </h1>
            <p className="font-mono text-xs text-ink-500">{payment.reference}</p>
          </div>
        </header>

        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Paid by</dt>
            <dd className="mt-0.5 font-medium text-ink-900">{payer?.fullName ?? "—"}</dd>
            <dd className="text-ink-500">{payer?.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Status</dt>
            <dd className="mt-0.5">
              <Badge tone={status.tone}>{status.label}</Badge>
            </dd>
            {payment.failureReason && payment.status !== "successful" && <dd className="mt-1 text-xs text-ink-500">{payment.failureReason}</dd>}
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Date</dt>
            <dd className="mt-0.5 text-ink-900">{formatDateTime(payment.verifiedAt ?? payment.createdAt)}</dd>
            {payment.verifiedAt && <dd className="text-xs text-ink-500">verified by provider</dd>}
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Provider</dt>
            <dd className="mt-0.5 text-ink-900">Flutterwave</dd>
            <dd className="font-mono text-xs text-ink-500">{payment.providerRef ? `ref ${payment.providerRef}` : "no provider reference yet"}{payment.providerTxId ? ` · tx ${payment.providerTxId}` : ""}</dd>
          </div>
        </dl>

        <table className="tl-table mt-6">
          <thead>
            <tr>
              <th>Item</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, idx) => (
              <tr key={idx}>
                <td>
                  <span className="font-medium text-ink-900">{i.label}</span>
                  {i.detail && <span className="block text-xs text-ink-500">{i.detail}</span>}
                </td>
                <td className="whitespace-nowrap text-right">{i.amount.startsWith("-") ? `−${formatNgn(i.amount.slice(1))}` : formatNgn(i.amount)}</td>
              </tr>
            ))}
            {subtotal !== payment.amountNgn && (
              <tr>
                <td className="text-ink-500">Subtotal</td>
                <td className="text-right text-ink-500">{formatNgn(subtotal)}</td>
              </tr>
            )}
            <tr>
              <td className="font-semibold text-ink-900">Total charged</td>
              <td className="whitespace-nowrap text-right text-lg font-bold text-ink-900">{formatNgn(payment.amountNgn)}</td>
            </tr>
            {Number(refundedTotal) > 0 && (
              <>
                <tr>
                  <td className="text-ink-700">Refunded</td>
                  <td className="whitespace-nowrap text-right text-ink-700">−{formatNgn(refundedTotal)}</td>
                </tr>
                <tr>
                  <td className="font-semibold text-ink-900">Net paid</td>
                  <td className="whitespace-nowrap text-right font-semibold text-ink-900">{formatNgn(subNgn(payment.amountNgn, refundedTotal))}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>

        {refundRows.some((r) => r.status !== "completed") && (
          <p className="mt-4 text-xs text-ink-500">A refund of {formatNgn(refundRows.filter((r) => r.status !== "completed").reduce((acc, r) => addNgn(acc, r.amountNgn), "0.00"))} is in progress and will show here once the provider confirms it.</p>
        )}

        <footer className="mt-6 border-t border-ink-100 pt-4 text-xs text-ink-500">
          <p>All amounts in Nigerian naira (NGN). Payments are collected by Flutterwave on behalf of TutorLink. Processing fees are absorbed by the platform. Keep this receipt for your records; it is also available any time from your payments page.</p>
          <p className="mt-1">
            Generated {formatDateTime(new Date())} · Payment ID {payment.id}
          </p>
        </footer>
      </article>
    </main>
  );
}
