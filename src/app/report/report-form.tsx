"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Select, Textarea } from "@/components/ui";
import { createReportAction } from "@/server/report-actions";

const REASONS = [
  { value: "harassment", label: "Harassment or abusive behaviour" },
  { value: "fraud", label: "Fraud, scam or payment outside TutorLink" },
  { value: "no_show", label: "Did not show up for a session" },
  { value: "unsafe", label: "Safety concern" },
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "other", label: "Something else" },
];

export function ReportForm({ type, id }: { type: string; id: string }) {
  return (
    <ActionForm action={createReportAction} className="mt-6 space-y-4" submitLabel="Send report" submitVariant="danger">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={id} />
      <Field label="Reason" name="reason" required>
        <Select id="reason" name="reason" required defaultValue="">
          <option value="" disabled>
            Choose a reason
          </option>
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        <FieldError name="reason" />
      </Field>
      <Field label="What happened?" name="details" help="Dates, what was said or done, and anything that helps us look into it. Do not include passwords or card details.">
        <Textarea id="details" name="details" maxLength={2000} />
        <FieldError name="details" />
      </Field>
    </ActionForm>
  );
}
