import "server-only";

/**
 * Flutterwave v3 REST client (https://developer.flutterwave.com/v3.0/docs).
 *
 * Endpoints used (verified against the current docs):
 *   POST https://api.flutterwave.com/v3/payments                     — Standard checkout, returns data.link
 *   GET  https://api.flutterwave.com/v3/transactions/{id}/verify     — authoritative status/amount/currency/tx_ref
 *   GET  https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=
 *   POST https://api.flutterwave.com/v3/transactions/{id}/refund     — { amount }
 *   POST https://api.flutterwave.com/v3/transfers                    — payouts (gated, see below)
 *   GET  https://api.flutterwave.com/v3/banks/NG
 *
 * Webhooks: header `verif-hash` must equal FLUTTERWAVE_WEBHOOK_HASH (the secret hash set in
 * Dashboard → Settings → Webhooks). Events are re-verified with the verify endpoint before value is given.
 *
 * The secret key never leaves the server. Payouts additionally require PAYOUTS_ENABLED=true.
 */

const BASE = "https://api.flutterwave.com/v3";

export class FlutterwaveError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(message);
  }
}

export function flutterwaveConfigured() {
  return Boolean(process.env.FLUTTERWAVE_SECRET_KEY);
}

export function flutterwaveMode(): "test" | "live" {
  const key = process.env.FLUTTERWAVE_SECRET_KEY ?? "";
  if (key.includes("_TEST-")) return "test";
  return (process.env.FLUTTERWAVE_MODE === "live" ? "live" : "test") as "test" | "live";
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!key) throw new FlutterwaveError("Payments are not configured on this deployment (FLUTTERWAVE_SECRET_KEY missing).");
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string; data?: unknown };
  if (!res.ok || body.status !== "success") {
    throw new FlutterwaveError(body.message ?? `Flutterwave request failed (${res.status})`, res.status, body);
  }
  return body as T;
}

export type InitializeInput = {
  txRef: string;
  amount: string; // NGN, 2dp
  customer: { email: string; name: string; phonenumber?: string | null };
  redirectUrl: string;
  title: string;
  description: string;
  meta?: Record<string, string | number>;
};

export async function initializePayment(input: InitializeInput): Promise<{ link: string }> {
  const body = {
    tx_ref: input.txRef,
    amount: input.amount,
    currency: "NGN",
    redirect_url: input.redirectUrl,
    customer: { email: input.customer.email, name: input.customer.name, phonenumber: input.customer.phonenumber ?? undefined },
    customizations: { title: input.title, description: input.description, logo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/brand/icon-512.png` },
    meta: input.meta,
    session_duration: 30,
  };
  const res = await call<{ data: { link: string } }>("/payments", { method: "POST", body: JSON.stringify(body) });
  return { link: res.data.link };
}

export type VerifiedTransaction = {
  id: number;
  tx_ref: string;
  flw_ref: string;
  amount: number;
  charged_amount: number;
  app_fee: number;
  currency: string;
  status: string; // "successful" | "failed" | "pending" ...
  processor_response?: string;
  customer?: { email?: string };
  created_at?: string;
};

export async function verifyTransaction(id: string | number): Promise<VerifiedTransaction> {
  const res = await call<{ data: VerifiedTransaction }>(`/transactions/${encodeURIComponent(String(id))}/verify`);
  return res.data;
}

export async function verifyByReference(txRef: string): Promise<VerifiedTransaction> {
  const res = await call<{ data: VerifiedTransaction }>(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`);
  return res.data;
}

export async function refundTransaction(id: string | number, amount?: string): Promise<{ id: number; status: string }> {
  const res = await call<{ data: { id: number; status: string } }>(`/transactions/${encodeURIComponent(String(id))}/refund`, {
    method: "POST",
    body: JSON.stringify(amount ? { amount: Number(amount) } : {}),
  });
  return res.data;
}

export async function listBanks(): Promise<{ code: string; name: string }[]> {
  const res = await call<{ data: { code: string; name: string }[] }>("/banks/NG");
  return res.data;
}

export function payoutsEnabled() {
  return process.env.PAYOUTS_ENABLED === "true";
}

/**
 * Bank transfer (payout). Refused unless PAYOUTS_ENABLED=true. In test mode Flutterwave
 * transfers resolve against the sandbox and move no real money.
 */
export async function initiateTransfer(input: { bankCode: string; accountNumber: string; amount: string; narration: string; reference: string; beneficiaryName: string }) {
  if (!payoutsEnabled()) throw new FlutterwaveError("Payouts are disabled on this deployment (PAYOUTS_ENABLED is not true).");
  const res = await call<{ data: { id: number; status: string; reference: string } }>("/transfers", {
    method: "POST",
    body: JSON.stringify({
      account_bank: input.bankCode,
      account_number: input.accountNumber,
      amount: Number(input.amount),
      narration: input.narration,
      currency: "NGN",
      reference: input.reference,
      beneficiary_name: input.beneficiaryName,
    }),
  });
  return res.data;
}

export function webhookHashValid(headerValue: string | null) {
  const expected = process.env.FLUTTERWAVE_WEBHOOK_HASH;
  if (!expected || !headerValue) return false;
  if (headerValue.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ headerValue.charCodeAt(i);
  return diff === 0;
}
