"use client";

import { Field, Select, Textarea } from "@/components/ui";
import { forceUnlistAction, reviewIdentityAction, reviewQualificationAction } from "@/server/admin-actions";
import { AdminForm, FieldError } from "../../_components/forms";

const DECISIONS = [
  { value: "verified", label: "Approve (verified)" },
  { value: "needs_info", label: "Needs more information" },
  { value: "rejected", label: "Reject" },
];

export function IdentityReviewForm({ tutorId, current }: { tutorId: string; current: string }) {
  return (
    <AdminForm action={reviewIdentityAction} hidden={{ tutorId }} submitLabel="Save identity decision">
      <Field label="Decision" name="decision" required>
        <Select id="decision" name="decision" defaultValue={current === "verified" ? "verified" : "needs_info"}>
          {DECISIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
        <FieldError name="decision" />
      </Field>
      <Field label="Note to tutor" name="note" help="Required for reject / needs info. Rejecting or asking for info also removes the tutor from search until resolved.">
        <Textarea id="note" name="note" maxLength={2000} />
        <FieldError name="note" />
      </Field>
    </AdminForm>
  );
}

export function QualificationReviewForm({ qualificationId, current }: { qualificationId: string; current: string }) {
  return (
    <AdminForm action={reviewQualificationAction} hidden={{ qualificationId }} submitLabel="Save" inline>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Decision" name={`decision-${qualificationId}`}>
          <Select id={`decision-${qualificationId}`} name="decision" defaultValue={current === "verified" ? "verified" : current === "rejected" ? "rejected" : "needs_info"}>
            {DECISIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note" name={`note-${qualificationId}`}>
          <Textarea id={`note-${qualificationId}`} name="note" maxLength={2000} className="!min-h-[44px]" rows={1} />
          <FieldError name="note" />
        </Field>
      </div>
    </AdminForm>
  );
}

export function ForceUnlistForm({ tutorId }: { tutorId: string }) {
  return (
    <AdminForm action={forceUnlistAction} hidden={{ tutorId }} submitLabel="Force unlist" variant="danger" confirm="I understand the tutor will disappear from search immediately and be notified with this reason.">
      <Field label="Reason" name="reason" required>
        <Textarea id="unlist-reason" name="reason" maxLength={2000} required />
        <FieldError name="reason" />
      </Field>
    </AdminForm>
  );
}
