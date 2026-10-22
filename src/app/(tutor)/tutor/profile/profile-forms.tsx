"use client";

import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { addQualificationAction, removeQualificationAction, setListedAction, submitIdentityAction, updateTutorProfileAction } from "@/server/tutor-profile-actions";

const LEVELS = [
  { value: "primary", label: "Primary" },
  { value: "junior_secondary", label: "Junior secondary (JSS)" },
  { value: "senior_secondary", label: "Senior secondary (SSS)" },
  { value: "tertiary", label: "University / Polytechnic" },
  { value: "adult", label: "Adult & professional" },
];

export function ProfileForm({
  values,
  subjects,
  exams,
}: {
  values: { headline: string | null; bio: string | null; yearsExperience: number; offersPhysical: boolean; offersOnline: boolean; subjectIds: number[]; levels: string[]; examIds: number[] };
  subjects: { id: number; name: string; category: string }[];
  exams: { id: number; name: string }[];
}) {
  const cats = Array.from(new Set(subjects.map((s) => s.category)));
  return (
    <ActionForm action={updateTutorProfileAction} submitLabel="Save profile" className="space-y-5">
      <Field label="Headline" name="headline" help="One line students see in search results, e.g. “WAEC & JAMB Mathematics coach, 6 years’ experience”.">
        <Input id="headline" name="headline" defaultValue={values.headline ?? ""} maxLength={120} />
        <FieldError name="headline" />
      </Field>
      <Field label="About you" name="bio" required help="40–2000 characters. Teaching style, results, what students can expect.">
        <Textarea id="bio" name="bio" defaultValue={values.bio ?? ""} minLength={40} maxLength={2000} required className="min-h-[140px]" />
        <FieldError name="bio" />
      </Field>
      <Field label="Years of experience" name="yearsExperience" required>
        <Input id="yearsExperience" name="yearsExperience" type="number" min={0} max={60} defaultValue={values.yearsExperience} required className="sm:max-w-[160px]" />
        <FieldError name="yearsExperience" />
      </Field>
      <fieldset>
        <legend className="tl-label">Teaching formats</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Checkbox name="offersOnline" value="1" defaultChecked={values.offersOnline} label="Online (video call / chat)" />
          <Checkbox name="offersPhysical" value="1" defaultChecked={values.offersPhysical} label="In person (home or centre) — add service areas under Availability" />
        </div>
        <FieldError name="offersOnline" />
      </fieldset>
      <fieldset>
        <legend className="tl-label">Academic levels you teach</legend>
        <p className="tl-help mb-2 mt-0">Applied to every subject you select.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {LEVELS.map((l) => (
            <Checkbox key={l.value} name="levels[]" value={l.value} defaultChecked={values.levels.includes(l.value)} label={l.label} />
          ))}
        </div>
        <FieldError name="levels" />
      </fieldset>
      <fieldset>
        <legend className="tl-label">Subjects</legend>
        <div className="max-h-80 space-y-3 overflow-y-auto rounded-[var(--radius-md)] border border-ink-200 p-3">
          {cats.map((c) => (
            <div key={c}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">{c}</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {subjects
                  .filter((s) => s.category === c)
                  .map((s) => (
                    <Checkbox key={s.id} name="subjectIds[]" value={s.id} defaultChecked={values.subjectIds.includes(s.id)} label={s.name} />
                  ))}
              </div>
            </div>
          ))}
        </div>
        <FieldError name="subjectIds" />
      </fieldset>
      <fieldset>
        <legend className="tl-label">Exams you prepare students for</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {exams.map((e) => (
            <Checkbox key={e.id} name="examIds[]" value={e.id} defaultChecked={values.examIds.includes(e.id)} label={e.name} />
          ))}
        </div>
        <FieldError name="examIds" />
      </fieldset>
    </ActionForm>
  );
}

export function QualificationForm() {
  const year = new Date().getFullYear();
  return (
    <ActionForm action={addQualificationAction} submitLabel="Add qualification" submitVariant="outline" resetOnSuccess className="grid gap-4 sm:grid-cols-2">
      <Field label="Title" name="title" required help="e.g. B.Sc. Mathematics, PGDE, TRCN licence">
        <Input id="title" name="title" required minLength={3} maxLength={160} />
        <FieldError name="title" />
      </Field>
      <Field label="Institution" name="institution" required>
        <Input id="institution" name="institution" required minLength={2} maxLength={160} />
        <FieldError name="institution" />
      </Field>
      <Field label="Year obtained" name="yearObtained">
        <Input id="yearObtained" name="yearObtained" type="number" min={1950} max={year} inputMode="numeric" />
        <FieldError name="yearObtained" />
      </Field>
      <Field label="Document reference" name="documentRef" help="Describe the document you will present (e.g. “Certificate no. 12345, original available”). File upload is not configured yet; an admin may ask you to present it.">
        <Input id="documentRef" name="documentRef" maxLength={300} />
        <FieldError name="documentRef" />
      </Field>
    </ActionForm>
  );
}

export function RemoveQualificationButton({ id }: { id: string }) {
  return (
    <ActionForm action={removeQualificationAction} hideSubmit>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm">
        Remove
      </SubmitButton>
    </ActionForm>
  );
}

export function IdentityForm({ types }: { types: { value: string; label: string }[] }) {
  return (
    <ActionForm action={submitIdentityAction} submitLabel="Submit for review" className="space-y-4">
      <Field label="Document type" name="documentType" required>
        <Select id="documentType" name="documentType" defaultValue="" required>
          <option value="">Choose a document</option>
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <FieldError name="documentType" />
      </Field>
      <Field label="Document number" name="documentNumber" required help="Stored privately and shown only to verification admins. Never displayed on your public profile. File upload is not configured; an admin may contact you to present the document.">
        <Input id="documentNumber" name="documentNumber" required minLength={6} maxLength={40} autoComplete="off" />
        <FieldError name="documentNumber" />
      </Field>
      <Checkbox name="consent" value="1" label="I confirm these details are mine and accurate. Submitting false details leads to account suspension." />
      <FieldError name="consent" />
    </ActionForm>
  );
}

export function ListingToggle({ listed, canList }: { listed: boolean; canList: boolean }) {
  return (
    <ActionForm action={setListedAction} hideSubmit>
      <input type="hidden" name="listed" value={listed ? "0" : "1"} />
      {listed ? (
        <SubmitButton variant="outline">Hide my profile from search</SubmitButton>
      ) : (
        <SubmitButton variant={canList ? "secondary" : "outline"}>List my profile</SubmitButton>
      )}
    </ActionForm>
  );
}
