import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { flutterwaveConfigured } from "@/server/flutterwave";
import { checkoutUrlFor } from "@/server/payments";

export const dynamic = "force-dynamic";

/** Redirects the payer to the Flutterwave hosted checkout for their own initiated payment. */
export async function GET(_req: Request, ctx: RouteContext<"/pay/[paymentId]">) {
  const { paymentId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=/pay/${paymentId}`, process.env.NEXT_PUBLIC_APP_URL));
  const payment = await db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!payment || payment.userId !== user.id) return new NextResponse("Not found", { status: 404 });
  if (payment.status !== "initiated") return NextResponse.redirect(new URL(`/payments/callback?ref=${payment.reference}`, process.env.NEXT_PUBLIC_APP_URL));
  if (!flutterwaveConfigured()) return NextResponse.redirect(new URL(`/payments/callback?ref=${payment.reference}&unconfigured=1`, process.env.NEXT_PUBLIC_APP_URL));
  try {
    const url = await checkoutUrlFor(payment.id);
    return NextResponse.redirect(url);
  } catch (e) {
    console.error(e);
    return NextResponse.redirect(new URL(`/payments/callback?ref=${payment.reference}&error=init`, process.env.NEXT_PUBLIC_APP_URL));
  }
}
