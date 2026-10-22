"use client";

import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Alert, Field, Input, Select, Textarea } from "@/components/ui";
import { archivePackageAction, createPackageAction, publishPackageAction, unpublishPackageAction, updatePackageAction } from "@/server/package-actions";

export type PackageFormValues = {
  id?: string;
  title?: string;
  description?: string;
  subjectId?: number;
  level?: string;
  examId?: number | null;
  format?: string;
  priceNgn?: string;
  durationMinutes?: number;
  sessionsCount?: number;
  outcomes?: string[];
  requirements?: string | null;
  status?: string;
};

const LEVELS = [
  { value: "primary", label: "Primary" },
  { value: "junior_secondary", label: "Junior secondary (JSS)" },
  { value: "senior_secondary", label: "Senior secondary (SSS)" },
  { value: "tertiary", label: "University / Polytechnic" },
  { value: "adult", label: "Adult & professional" },
];

export function PackageForm({
  values,
  subjects,
  exams,
  formats,
}: {
  values: PackageFormValues;
  subjects: { id: number; name: string }[];
  exams: { id: number; name: string }[];
  formats: { physical: boolean; online: boolean };
}) {
  const editing = !!values.id;
  const durations = Array.from({ length: (480 - 30) / 15 + 1 }, (_, i) => 30 + i * 15);
  return (
    <ActionForm action={editing ? updatePackageAction : createPackageAction} submitLabel={editing ? "Save changes" : "Create draft"} className="space-y-5" successMessage={editing ? "Package saved." : undefined}>
      {editing && <input type="hidden" name="packageId" value={values.id} />}
      <Field label="Title" name="title" required help="5–120 characters. E.g. “WAEC Mathematics crash course (4 sessions)”.">
        <Input id="title" name="title" defaultValue={values.title ?? ""} minLength={5} maxLength={120} required />
        <FieldError name="title" />
      </Field>
      <Field label="Description" name="description" required help="40–3000 characters. Who it is for, what you cover, how sessions run.">
        <Textarea id="description" name="description" defaultValue={values.description ?? ""} minLength={40} maxLength={3000} required className="min-h-[140px]" />
        <FieldError name="description" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Subject" name="subjectId" required help="Only subjects on your profile are listed.">
          <Select id="subjectId" name="subjectId" defaultValue={values.subjectId ?? ""} required>
            <option value="">Choose a subject</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <FieldError name="subjectId" />
        </Field>
        <Field label="Level" name="level" required>
          <Select id="level" name="level" defaultValue={values.level ?? ""} required>
            <option value="">Choose a level</option>
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
          <FieldError name="level" />
        </Field>
        <Field label="Exam focus" name="examId" help="Optional.">
          <Select id="examId" name="examId" defaultValue={values.examId ?? ""}>
            <option value="">No specific exam</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
          <FieldError name="examId" />
        </Field>
        <Field label="Format" name="format" required help={!formats.physical || !formats.online ? "Change your formats under Profile & verification to unlock more options." : undefined}>
          <Select id="format" name="format" defaultValue={values.format ?? (formats.online ? "online" : "physical")} required>
            {formats.online && <option value="online">Online</option>}
            {formats.physical && <option value="physical">In person</option>}
            {formats.online && formats.physical && <option value="hybrid">In person or online (student chooses)</option>}
          </Select>
          <FieldError name="format" />
        </Field>
        <Field label="Price (₦, whole package)" name="priceNgn" required help="₦500 – ₦500,000. Platform commission is deducted from this per your plan.">
          <Input id="priceNgn" name="priceNgn" inputMode="decimal" defaultValue={values.priceNgn ? String(Number(values.priceNgn)) : ""} required placeholder="e.g. 15000" />
          <FieldError name="priceNgn" />
        </Field>
        <Field label="Duration per session" name="durationMinutes" required>
          <Select id="durationMinutes" name="durationMinutes" defaultValue={values.durationMinutes ?? 60} required>
            {durations.map((m) => (
              <option key={m} value={m}>
                {m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`}
              </option>
            ))}
          </Select>
          <FieldError name="durationMinutes" />
        </Field>
        <Field label="Number of sessions" name="sessionsCount" required help="1–20. Each booking schedules the first session; further sessions are arranged with the student.">
          <Input id="sessionsCount" name="sessionsCount" type="number" min={1} max={20} defaultValue={values.sessionsCount ?? 1} required />
          <FieldError name="sessionsCount" />
        </Field>
      </div>
      <Field label="Learning outcomes" name="outcomes" help="One per line, up to 8. Shown as a checklist on your profile.">
        <Textarea id="outcomes" name="outcomes" defaultValue={(values.outcomes ?? []).join("\n")} className="min-h-[110px]" placeholder={"Solve WAEC past questions under time pressure\nMaster quadratic equations and graphs"} />
        <FieldError name="outcomes" />
      </Field>
      <Field label="Requirements" name="requirements" help="Optional. Materials, prior knowledge, a quiet space, etc.">
        <Textarea id="requirements" name="requirements" defaultValue={values.requirements ?? ""} maxLength={1000} className="min-h-[70px]" />
        <FieldError name="requirements" />
      </Field>
    </ActionForm>
  );
}

export function PackageStatusActions({ id, status, canPublish, limitText }: { id: string; status: string; canPublish: boolean; limitText: string }) {
  return (
    <div className="flex flex-col gap-3">
      {status !== "published" && status !== "archived" && (
        <ActionForm action={publishPackageAction} hideSubmit>
          <input type="hidden" name="packageId" value={id} />
          {!canPublish && (
            <Alert tone="warning" title="Plan limit reached" className="mb-3">
              {limitText}{" "}
              <a href="/tutor/subscription" className="font-semibold underline">
                See plans
              </a>
            </Alert>
          )}
          <SubmitButton variant="secondary">Publish</SubmitButton>
        </ActionForm>
      )}
      {status === "published" && (
        <ActionForm action={unpublishPackageAction} hideSubmit>
          <input type="hidden" name="packageId" value={id} />
          <SubmitButton variant="outline">Unpublish</SubmitButton>
        </ActionForm>
      )}
      {status !== "archived" && (
        <ActionForm action={archivePackageAction} hideSubmit>
          <input type="hidden" name="packageId" value={id} />
          <SubmitButton variant="ghost">Archive</SubmitButton>
          <p className="tl-help">Archiving hides the package permanently but keeps all its bookings and history. Packages are never deleted.</p>
        </ActionForm>
      )}
    </div>
  );
}
