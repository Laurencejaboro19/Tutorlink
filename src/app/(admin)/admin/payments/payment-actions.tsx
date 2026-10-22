"use client";

import { Field, Input, Textarea } from "@/components/ui";
import {
  approvePayoutAction,
  approveRefundAction,
  executePayoutAction,
  executeRefundAction,
  markPayoutCompletedAction,
  markPayoutFailedAction,
  rejectPayoutAction,
  rejectRefundAction,
  retryWebhookAction,
  reverifyPaymentAction,
} from "@/server/admin-actions";
import { AdminForm, FieldError } from "../_components/forms";

export function ReverifyButton({ paymentId }: { paymentId: string }) {
  return <AdminForm action={reverifyPaymentAction} hidden={{ paymentId }} submitLabel="Re-verify with provider" variant="outline" inline />;
}

export function RetryWebhookButton({ eventId }: { eventId: string }) {
  return <AdminForm action={retryWebhookAction} hidden={{ eventId }} submitLabel="Retry" variant="outline" inline />;
}

export function RefundActions({ refundId, status }: { refundId: string; status: string }) {
  return (
    <div className="flex flex-col gap-3">
      {(status === "requested" || status === "failed") && (
        <AdminForm action={approveRefundAction} hidden={{ refundId }} submitLabel="Approve" variant="secondary" inline>
          <Input name="note" placeholder="Note (optional)" aria-label="Approval note" className="!min-h-[40px] text-sm" />
        </AdminForm>
      )}
      {(status === "approved" || status === "failed") && <AdminForm action={executeRefundAction} hidden={{ refundId }} submitLabel="Execute refund" inline confirm="I understand this sends money back to the payer via the provider." />}
      {(status === "requested" || status === "approved" || status === "failed") && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-danger-600 hover:underline">Reject…</summary>
          <AdminForm action={rejectRefundAction} hidden={{ refundId }} submitLabel="Reject refund" variant="danger" inline className="mt-2 flex flex-col gap-2">
            <Textarea name="note" placeholder="Reason sent to the student" aria-label="Rejection note" className="!min-h-[60px] text-sm" required />
            <FieldError name="note" />
          </AdminForm>
        </details>
      )}
    </div>
  );
}

export function PayoutActions({ payoutId, status }: { payoutId: string; status: string }) {
  return (
    <div className="flex flex-col gap-3">
      {status === "requested" && (
        <>
          <AdminForm action={approvePayoutAction} hidden={{ payoutId }} submitLabel="Approve" variant="secondary" inline confirm="I understand this posts the ledger debit now." />
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-danger-600 hover:underline">Reject…</summary>
            <AdminForm action={rejectPayoutAction} hidden={{ payoutId }} submitLabel="Reject payout" variant="danger" inline className="mt-2 flex flex-col gap-2">
              <Textarea name="reason" placeholder="Reason sent to the tutor" aria-label="Rejection reason" className="!min-h-[60px] text-sm" required />
              <FieldError name="reason" />
            </AdminForm>
          </details>
        </>
      )}
      {status === "approved" && <AdminForm action={executePayoutAction} hidden={{ payoutId }} submitLabel="Execute transfer" inline confirm="I understand this sends a bank transfer via the provider." />}
      {(status === "approved" || status === "initiated") && (
        <>
          <AdminForm action={markPayoutCompletedAction} hidden={{ payoutId }} submitLabel="Mark completed" variant="outline" inline confirm="I have confirmed with the provider or bank that this transfer landed." />
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-danger-600 hover:underline">Mark failed…</summary>
            <AdminForm action={markPayoutFailedAction} hidden={{ payoutId }} submitLabel="Mark failed" variant="danger" inline className="mt-2 flex flex-col gap-2" confirm="I understand the amount returns to the tutor's balance.">
              <Field label="Reason" name={`fail-${payoutId}`}>
                <Input id={`fail-${payoutId}`} name="reason" required className="!min-h-[40px] text-sm" />
                <FieldError name="reason" />
              </Field>
            </AdminForm>
          </details>
        </>
      )}
    </div>
  );
}
