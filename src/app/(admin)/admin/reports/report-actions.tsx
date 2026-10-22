"use client";

import { Field, Select, Textarea } from "@/components/ui";
import { archiveChallengeAction, hideReviewAction, setReportStatusAction, suspendUserAction } from "@/server/admin-actions";
import { AdminForm, FieldError } from "../_components/forms";

export function ReportStatusForm({ reportId, current }: { reportId: string; current: string }) {
  return (
    <AdminForm action={setReportStatusAction} hidden={{ reportId }} submitLabel="Update report">
      <Field label="Status" name="status" required>
        <Select id="status" name="status" defaultValue={current === "open" ? "investigating" : current}>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved (action taken)</option>
          <option value="dismissed">Dismissed (no breach)</option>
        </Select>
      </Field>
      <Field label="Resolution note (internal)" name="note" help="Required when resolving or dismissing.">
        <Textarea id="note" name="note" maxLength={2000} />
        <FieldError name="note" />
      </Field>
    </AdminForm>
  );
}

export function QuickSuspend({ userId, reason }: { userId: string; reason: string }) {
  return (
    <AdminForm action={suspendUserAction} hidden={{ userId }} submitLabel="Suspend reported user" variant="danger" confirm="I understand this signs the user out everywhere and blocks sign-in.">
      <Field label="Reason" name="suspend-reason">
        <Textarea id="suspend-reason" name="reason" defaultValue={reason} maxLength={2000} className="!min-h-[80px]" required />
        <FieldError name="reason" />
      </Field>
    </AdminForm>
  );
}

export function QuickHideReview({ reviewId, reason }: { reviewId: string; reason: string }) {
  return (
    <AdminForm action={hideReviewAction} hidden={{ reviewId }} submitLabel="Hide review" variant="danger" confirm="I understand the review disappears from the tutor's profile and their rank is recomputed.">
      <Field label="Reason" name="hide-reason">
        <Textarea id="hide-reason" name="reason" defaultValue={reason} maxLength={2000} className="!min-h-[80px]" required />
        <FieldError name="reason" />
      </Field>
    </AdminForm>
  );
}

export function QuickArchiveChallenge({ challengeId, reason }: { challengeId: string; reason: string }) {
  return (
    <AdminForm action={archiveChallengeAction} hidden={{ challengeId }} submitLabel="Archive challenge" variant="danger" confirm="I understand students can no longer see this challenge.">
      <Field label="Reason (sent to creator)" name="archive-reason">
        <Textarea id="archive-reason" name="reason" defaultValue={reason} maxLength={2000} className="!min-h-[80px]" />
        <FieldError name="reason" />
      </Field>
    </AdminForm>
  );
}
