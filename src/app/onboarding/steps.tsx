"use client";

import { useState } from "react";
import { ActionForm, FieldError, useFormResult } from "@/components/action-form";
import { LocationPicker } from "@/components/location-picker";
import { Alert, Checkbox, Field, Input, Textarea } from "@/components/ui";
import { completeProfileAction, setLocationAction, setRoleAction } from "@/server/onboarding-actions";
import { resendVerificationAction } from "@/server/auth-actions";

const LEVELS = [
  { value: "primary", label: "Primary" },
  { value: "junior_secondary", label: "Junior secondary (JSS)" },
  { value: "senior_secondary", label: "Senior secondary (SSS)" },
  { value: "tertiary", label: "University / Polytechnic" },
  { value: "adult", label: "Adult & professional" },
];

function DebugLink() {
  const { state } = useFormResult();
  const link = state?.ok ? (state.data as { debugLink?: string } | undefined)?.debugLink : undefined;
  if (!link) return null;
  return (
    <Alert tone="warning" title="Email delivery is not configured on this deployment" className="mt-4">
      Open this link to verify: <a className="break-all underline" href={link}>{link}</a>
    </Alert>
  );
}

export function VerifyStep({ email }: { email: string }) {
  return (
    <>
      <h1 className="text-xl font-bold text-ink-900">Check your inbox</h1>
      <p className="mt-2 text-sm text-ink-600">
        We sent a verification link to <strong>{email}</strong>. Open it to continue. The link is valid for 24 hours.
      </p>
      <ActionForm action={resendVerificationAction} className="mt-6" submitLabel="Resend verification email" submitVariant="outline">
        <DebugLink />
      </ActionForm>
    </>
  );
}

export function LocationStep({ states }: { states: { id: number; name: string }[] }) {
  return (
    <>
      <h1 className="text-xl font-bold text-ink-900">Where are you based?</h1>
      <p className="mt-2 text-sm text-ink-600">We use this to show tutors who can reach you for in-person lessons. Online tutoring is never limited by location.</p>
      <ActionForm action={setLocationAction} className="mt-6" submitLabel="Continue">
        <LocationPicker states={states} />
      </ActionForm>
    </>
  );
}

export function RoleStep() {
  const [role, setRole] = useState<"student" | "tutor" | "both">("student");
  const opts = [
    { v: "student", t: "I want to learn", d: "Find tutors, book sessions, join daily challenges and earn rewards." },
    { v: "tutor", t: "I want to teach", d: "Publish packages, manage bookings and grow your tutoring business." },
    { v: "both", t: "Both", d: "One account for learning and teaching — no duplicate profiles." },
  ] as const;
  return (
    <>
      <h1 className="text-xl font-bold text-ink-900">How will you use TutorLink?</h1>
      <p className="mt-2 text-sm text-ink-600">You can add the other role later from your account settings.</p>
      <ActionForm action={setRoleAction} className="mt-6" submitLabel="Continue">
        <div className="grid gap-3" role="radiogroup" aria-label="Account type">
          {opts.map((o) => (
            <label key={o.v} className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-4 transition-colors ${role === o.v ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:border-ink-300"}`}>
              <input type="radio" name="role" value={o.v} checked={role === o.v} onChange={() => setRole(o.v)} className="mt-1 accent-brand-600" />
              <span>
                <span className="block font-semibold text-ink-900">{o.t}</span>
                <span className="block text-sm text-ink-600">{o.d}</span>
              </span>
            </label>
          ))}
        </div>
        <FieldError name="role" />
      </ActionForm>
    </>
  );
}

export function ProfileStep({ isTutor, fullName, subjects }: { isTutor: boolean; fullName: string; subjects: { id: number; name: string; category: string }[] }) {
  const cats = Array.from(new Set(subjects.map((s) => s.category)));
  return (
    <>
      <h1 className="text-xl font-bold text-ink-900">{isTutor ? "Set up your tutor profile" : "Almost done"}</h1>
      <p className="mt-2 text-sm text-ink-600">{isTutor ? "Students see your headline, bio and subjects. Verification comes next." : "A display name and phone number so tutors can reach you about sessions."}</p>
      <ActionForm action={completeProfileAction} className="mt-6 space-y-4" submitLabel="Finish setup">
        <Field label="Display name" name="displayName" required help="Shown on bookings and reviews.">
          <Input id="displayName" name="displayName" defaultValue={fullName.split(" ")[0]} maxLength={60} required />
          <FieldError name="displayName" />
        </Field>
        <Field label="Phone number" name="phone" required help="Nigerian number, e.g. 0803 123 4567. Shared only with confirmed bookings.">
          <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required />
          <FieldError name="phone" />
        </Field>
        {isTutor && (
          <>
            <Field label="Headline" name="headline" help="One line, e.g. “WAEC & JAMB Mathematics coach, 6 years’ experience”.">
              <Input id="headline" name="headline" maxLength={120} />
              <FieldError name="headline" />
            </Field>
            <Field label="About you" name="bio" required help="At least 40 characters. Teaching style, results, what students can expect.">
              <Textarea id="bio" name="bio" maxLength={2000} required />
              <FieldError name="bio" />
            </Field>
            <fieldset>
              <legend className="tl-label">Teaching formats</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <Checkbox name="offersOnline" defaultChecked label="Online (video call / chat)" />
                <Checkbox name="offersPhysical" label="In person (home or centre)" />
              </div>
              <FieldError name="offersOnline" />
            </fieldset>
            <fieldset>
              <legend className="tl-label">Academic levels you teach</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {LEVELS.map((l) => (
                  <Checkbox key={l.value} name="levels[]" value={l.value} label={l.label} />
                ))}
              </div>
              <FieldError name="levels" />
            </fieldset>
            <fieldset>
              <legend className="tl-label">Subjects</legend>
              <div className="max-h-72 space-y-3 overflow-y-auto rounded-[var(--radius-md)] border border-ink-200 p-3">
                {cats.map((c) => (
                  <div key={c}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">{c}</p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {subjects
                        .filter((s) => s.category === c)
                        .map((s) => (
                          <Checkbox key={s.id} name="subjectIds[]" value={s.id} label={s.name} />
                        ))}
                    </div>
                  </div>
                ))}
              </div>
              <FieldError name="subjectIds" />
            </fieldset>
          </>
        )}
      </ActionForm>
    </>
  );
}
