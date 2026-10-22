"use client";

import { Field, Select, Textarea } from "@/components/ui";
import { archiveChallengeAction, reviewChallengeAction } from "@/server/admin-actions";
import { AdminForm, FieldError } from "../_components/forms";

export function ReviewChallengeForm({ challengeId }: { challengeId: string }) {
  return (
    <AdminForm action={reviewChallengeAction} hidden={{ challengeId }} submitLabel="Save decision">
      <Field label="Decision" name="decision" required>
        <Select id="decision" name="decision" defaultValue="approve">
          <option value="approve">Approve and publish</option>
          <option value="reject">Reject (send back to creator)</option>
        </Select>
      </Field>
      <Field label="Note to creator" name="note" help="Required when rejecting.">
        <Textarea id="review-note" name="note" maxLength={2000} />
        <FieldError name="note" />
      </Field>
    </AdminForm>
  );
}

export function ArchiveChallengeForm({ challengeId }: { challengeId: string }) {
  return (
    <AdminForm action={archiveChallengeAction} hidden={{ challengeId }} submitLabel="Archive challenge" variant="danger" confirm="I understand this removes the challenge from students; past attempts are kept.">
      <Field label="Reason (sent to creator)" name="reason">
        <Textarea id="archive-reason" name="reason" maxLength={2000} className="!min-h-[80px]" />
        <FieldError name="reason" />
      </Field>
    </AdminForm>
  );
}
