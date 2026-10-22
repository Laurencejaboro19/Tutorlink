"use client";

import { Field, Input, Select, Textarea } from "@/components/ui";
import { addBookingNoteAction, adminCancelBookingAction, resolveDisputeAction } from "@/server/admin-actions";
import { AdminForm, FieldError } from "../../_components/forms";

export function ResolveDisputeForm({ bookingId }: { bookingId: string }) {
  return (
    <AdminForm action={resolveDisputeAction} hidden={{ bookingId }} submitLabel="Resolve dispute" confirm="I understand this is final: ledger reversals, refunds and notifications are created immediately.">
      <Field label="Outcome" name="outcome" required>
        <Select id="outcome" name="outcome" defaultValue="completed">
          <option value="completed">Session happened — mark completed (no refund)</option>
          <option value="no_show_student">Student did not show</option>
          <option value="no_show_tutor">Tutor did not show</option>
          <option value="refunded">Refund the student</option>
        </Select>
        <FieldError name="outcome" />
      </Field>
      <Field label="Refund % of the amount paid" name="refundPct" help="Ignored when the outcome is 'completed'. 100 = full refund of cash and credits.">
        <Input id="refundPct" name="refundPct" type="number" min={0} max={100} defaultValue={0} />
        <FieldError name="refundPct" />
      </Field>
      <Field label="Resolution note (sent to both parties)" name="note" required>
        <Textarea id="note" name="note" maxLength={2000} required />
        <FieldError name="note" />
      </Field>
    </AdminForm>
  );
}

export function AdminCancelForm({ bookingId }: { bookingId: string }) {
  return (
    <AdminForm action={adminCancelBookingAction} hidden={{ bookingId }} submitLabel="Cancel booking" variant="danger" confirm="I understand this cancels the session, reverses allocations and requests a refund for the cash part per the cancellation policy.">
      <Field label="Reason" name="reason" required>
        <Textarea id="cancel-reason" name="reason" maxLength={2000} required />
        <FieldError name="reason" />
      </Field>
    </AdminForm>
  );
}

export function InternalNoteForm({ bookingId }: { bookingId: string }) {
  return (
    <AdminForm action={addBookingNoteAction} hidden={{ bookingId }} submitLabel="Add note" variant="outline">
      <Field label="Internal note (audit log only, not shown to users)" name="note">
        <Textarea id="internal-note" name="note" maxLength={2000} required className="!min-h-[80px]" />
        <FieldError name="note" />
      </Field>
    </AdminForm>
  );
}
