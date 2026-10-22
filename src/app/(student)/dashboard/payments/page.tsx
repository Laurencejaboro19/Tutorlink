import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { Badge, Card, CardHeader, Pagination, PageHeader, buttonClass, type Tone } from "@/components/ui";
import { requireStudent } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { paymentStatusLabel } from "@/lib/payment-status";
import { formatDateTime } from "@/lib/time";
import { flutterwaveConfigured } from "@/server/flutterwave";
import { listRefundsForUser, refundStatusLabel, type RefundStatus } from "@/server/refunds";

export const metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const RESUME_WINDOW_MS = 60 * 60_000;

function refundTone(s: RefundStatus): Tone {
  return s === "completed" ? "success" : s === "rejected" || s === "failed" ? "danger" : s === "requested" ? "warning" : "brand";
}

export default async function StudentPaymentsPage({ searchParams }: PageProps<"/dashboard/payments">) {
  const user = await requireStudent();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const rpage = Math.max(1, Number(sp.rpage ?? 1) || 1);

  const [rows, [{ n: total }], refundList] = await Promise.all([
    db.select().from(payments).where(eq(payments.userId, user.id)).orderBy(desc(payments.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(payments).where(eq(payments.userId, user.id)),
    listRefundsForUser(user.id, { page: rpage, pageSize: PAGE_SIZE }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const configured = flutterwaveConfigured();
  const now = new Date().getTime();

  return (
    <>
      <PageHeader eyebrow="Student" title="Payments" description="Every payment you have started, with its verified status from Flutterwave. A redirect back to TutorLink never counts as proof of payment." />

      <Card>
        <CardHeader title="Payment history" description={`${total} payment${total === 1 ? "" : "s"}`} />
        <div className="px-5 pb-5">
          {rows.length === 0 ? (
            <div className="text-sm text-ink-500">
              You have not made any payments yet.{" "}
              <Link href="/tutors" className="text-brand-600 underline-offset-2 hover:underline">
                Find a tutor
              </Link>{" "}
              to book your first session.
            </div>
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="tl-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Purpose</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const s = paymentStatusLabel(p.status);
                    const resumable = p.status === "initiated" && now - p.createdAt.getTime() < RESUME_WINDOW_MS;
                    return (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/receipts/${p.id}`} className="font-mono text-xs text-brand-600 underline-offset-2 hover:underline">
                            {p.reference}
                          </Link>
                        </td>
                        <td className="text-sm">
                          {p.purpose === "booking" ? "Tutoring session" : "Tutor plan"}
                          {p.bookingId && (
                            <Link href={`/dashboard/bookings/${p.bookingId}`} className="block text-xs text-brand-600 underline-offset-2 hover:underline">
                              View booking
                            </Link>
                          )}
                        </td>
                        <td className="whitespace-nowrap font-semibold">{formatNgn(p.amountNgn)}</td>
                        <td>
                          <Badge tone={s.tone}>{s.label}</Badge>
                          {p.failureReason && p.status !== "successful" && <span className="mt-1 block max-w-xs text-xs text-ink-500">{p.failureReason}</span>}
                        </td>
                        <td className="whitespace-nowrap text-xs text-ink-500">{formatDateTime(p.createdAt)}</td>
                        <td className="text-right">
                          {resumable ? (
                            configured ? (
                              <Link href={`/pay/${p.id}`} className={buttonClass("outline", "sm")}>
                                Resume payment
                              </Link>
                            ) : (
                              <span className="text-xs text-ink-500">Checkout unavailable on this deployment</span>
                            )
                          ) : p.status === "initiated" ? (
                            <span className="text-xs text-ink-500">Checkout window closed</span>
                          ) : (
                            <Link href={`/receipts/${p.id}`} className="text-xs text-brand-600 underline-offset-2 hover:underline">
                              Receipt
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pageCount={pageCount} hrefFor={(p) => `/dashboard/payments?page=${p}${rpage > 1 ? `&rpage=${rpage}` : ""}`} />
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Refunds" description="Refunds are created when a session is cancelled or a dispute is resolved in your favour. The money is sent back to the card or account you paid with." />
        <div className="px-5 pb-5">
          {refundList.rows.length === 0 ? (
            <p className="text-sm text-ink-500">No refunds on your account.</p>
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="tl-table min-w-[600px]">
                <thead>
                  <tr>
                    <th>Payment</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {refundList.rows.map(({ refund, paymentReference }) => (
                    <tr key={refund.id}>
                      <td>
                        <Link href={`/receipts/${refund.paymentId}`} className="font-mono text-xs text-brand-600 underline-offset-2 hover:underline">
                          {paymentReference}
                        </Link>
                        {refund.bookingId && (
                          <Link href={`/dashboard/bookings/${refund.bookingId}`} className="block text-xs text-brand-600 underline-offset-2 hover:underline">
                            View booking
                          </Link>
                        )}
                      </td>
                      <td className="whitespace-nowrap font-semibold">{formatNgn(refund.amountNgn)}</td>
                      <td>
                        <Badge tone={refundTone(refund.status)}>{refundStatusLabel(refund.status)}</Badge>
                        {refund.status === "rejected" && refund.reviewNote && <span className="mt-1 block max-w-xs text-xs text-ink-500">{refund.reviewNote}</span>}
                      </td>
                      <td className="max-w-xs text-xs text-ink-600">{refund.reason}</td>
                      <td className="whitespace-nowrap text-xs text-ink-500">{formatDateTime(refund.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={refundList.page} pageCount={refundList.pageCount} hrefFor={(p) => `/dashboard/payments?rpage=${p}${page > 1 ? `&page=${page}` : ""}`} />
        </div>
      </Card>
    </>
  );
}
