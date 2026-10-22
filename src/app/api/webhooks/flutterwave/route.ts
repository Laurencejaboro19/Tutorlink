import { NextResponse } from "next/server";
import { webhookHashValid } from "@/server/flutterwave";
import { handleWebhookEvent } from "@/server/payments";

export const dynamic = "force-dynamic";

/**
 * Flutterwave webhook. Configure in Dashboard → Settings → Webhooks:
 *   URL:          https://<your-domain>/api/webhooks/flutterwave
 *   Secret hash:  the value of FLUTTERWAVE_WEBHOOK_HASH
 * Requests without a matching `verif-hash` header are discarded (401).
 * Processing is idempotent and re-verifies every event with the provider.
 */
export async function POST(req: Request) {
  if (!webhookHashValid(req.headers.get("verif-hash"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const result = await handleWebhookEvent(payload as Parameters<typeof handleWebhookEvent>[0]);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("webhook processing failed", e);
    // 500 so Flutterwave retries; the event row records the error.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
