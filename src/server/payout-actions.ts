"use server";

import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { fail, succeed, toActionError, type ActionResult } from "@/lib/result";
import { moneySchema, parseForm, uuidSchema } from "@/lib/validation";
import { cancelPayoutRequest, requestPayout, saveBankAccount } from "@/server/payouts";

type R = ActionResult<{ redirectTo?: string }> | null;

const bankSchema = z.object({
  bankCode: z.string().trim().min(2, "Choose your bank").max(10),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "Account number must be exactly 10 digits"),
  accountName: z.string().trim().min(3, "Enter the account name as your bank has it").max(120),
});

export async function saveBankDetailsAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(bankSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await saveBankAccount(user.id, parsed.data);
    return succeed(undefined, "Bank details saved. Only the last 4 digits are ever shown again.");
  } catch (e) {
    return toActionError(e);
  }
}

const requestSchema = z.object({ amount: moneySchema });

export async function requestPayoutAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(requestSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    const payout = await requestPayout(user.id, parsed.data.amount);
    return succeed(undefined, `Payout request ${payout.reference} submitted. Your balance is unchanged until the finance team approves it.`);
  } catch (e) {
    return toActionError(e);
  }
}

const cancelSchema = z.object({ payoutId: uuidSchema });

export async function cancelPayoutRequestAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(cancelSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await cancelPayoutRequest(user.id, parsed.data.payoutId);
    return succeed(undefined, "Payout request withdrawn.");
  } catch (e) {
    return toActionError(e);
  }
}
