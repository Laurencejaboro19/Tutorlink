"use server";

import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { fail, succeed, toActionError, type ActionResult } from "@/lib/result";
import { parseForm, uuidSchema } from "@/lib/validation";
import { flutterwaveConfigured } from "@/server/flutterwave";
import { cancelAtPeriodEnd, startPaidSubscription } from "@/server/subscriptions";

type R = ActionResult<{ redirectTo?: string }> | null;

const startSchema = z.object({ plan: z.enum(["premium", "premium_plus"]) });

/** Creates a pending subscription + payment intent and sends the tutor to checkout. */
export async function startSubscriptionAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(startSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    if (!flutterwaveConfigured()) return fail("Payments are not configured on this deployment, so checkout cannot start. Nothing has been charged.");
    const { payment } = await startPaidSubscription(user.id, parsed.data.plan);
    return succeed({ redirectTo: `/pay/${payment.id}` });
  } catch (e) {
    return toActionError(e);
  }
}

const cancelSchema = z.object({ subscriptionId: uuidSchema, confirm: z.literal("on", { error: "Tick the box to confirm." }) });

/** Keeps benefits until the period ends; nothing is refunded and no package is removed. */
export async function cancelSubscriptionAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(cancelSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await cancelAtPeriodEnd(user.id, parsed.data.subscriptionId);
    return succeed(undefined, "Your plan will not renew. Benefits stay active until the end of the current period.");
  } catch (e) {
    return toActionError(e);
  }
}
