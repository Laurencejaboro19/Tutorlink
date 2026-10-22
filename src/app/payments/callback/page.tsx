import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { AppHeader, SiteFooter } from "@/components/shell";
import { Alert, buttonClass } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { flutterwaveConfigured } from "@/server/flutterwave";
import { reconcileByReference } from "@/server/payments";

export const metadata = { title: "Payment status" };
export const dynamic = "force-dynamic";

/**
 * Flutterwave redirects here with ?status=&tx_ref=&transaction_id=. The query string is
 * only used to look up our own payment row; the status shown comes from the provider's
 * verify endpoint (or the webhook that already applied it) — never from the URL.
 */
export default async function PaymentCallbackPage({ searchParams }: PageProps<"/payments/callback">) {
  const user = await requireUser();
  const sp = await searchParams;
  const ref = typeof sp.ref === "string" ? sp.ref : typeof sp.tx_ref === "string" ? sp.tx_ref : "";
  const txId = typeof sp.transaction_id === "string" ? sp.transaction_id : null;
  let payment = ref ? await db.query.payments.findFirst({ where: eq(payments.reference, ref) }) : null;
  if (payment && payment.userId !== user.id) payment = null;
  if (payment && payment.status === "initiated" && flutterwaveConfigured() && !sp.unconfigured) {
    try {
      payment = await reconcileByReference(payment.reference, txId);
    } catch (e) {
      console.error(e);
    }
  }
  const back = payment?.purpose === "subscription" ? "/tutor/subscription" : payment?.bookingId ? `/dashboard/bookings/${payment.bookingId}` : "/dashboard/bookings";

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-12 sm:px-6">
        <div className="tl-card p-6 sm:p-8">
          <h1 className="text-2xl font-bold text-ink-900">Payment status</h1>
          {!payment ? (
            <Alert tone="danger" className="mt-4">We could not find that payment on your account.</Alert>
          ) : (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-ink-500">Reference</dt>
                <dd className="font-mono text-xs">{payment.reference}</dd>
                <dt className="text-ink-500">Amount</dt>
                <dd className="font-semibold">{formatNgn(payment.amountNgn)}</dd>
                <dt className="text-ink-500">Status</dt>
                <dd className="font-semibold capitalize">{payment.status.replaceAll("_", " ")}</dd>
              </dl>
              {payment.status === "successful" && <Alert tone="success" className="mt-4" title="Payment verified">{payment.purpose === "booking" ? "Your session is confirmed." : "Your plan is now active."}</Alert>}
              {payment.status === "initiated" && (
                <Alert tone="warning" className="mt-4" title={sp.unconfigured ? "Payments are not configured on this deployment" : "Not confirmed yet"}>
                  {sp.unconfigured
                    ? "The operator has not added Flutterwave keys yet, so checkout cannot start. Nothing has been charged."
                    : "We have not received a successful confirmation from Flutterwave yet. If you completed the payment, this page will update once the provider confirms it — refresh in a moment. Nothing is confirmed on a redirect alone."}
                </Alert>
              )}
              {(payment.status === "failed" || payment.status === "cancelled") && <Alert tone="danger" className="mt-4" title="Payment not completed">{payment.failureReason ?? "The payment did not go through."} You have not been charged for a confirmed service.</Alert>}
            </>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={back} className={buttonClass("primary")}>Continue</Link>
            {payment?.status === "initiated" && !sp.unconfigured && <Link href={`/pay/${payment.id}`} className={buttonClass("outline")}>Try paying again</Link>}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
