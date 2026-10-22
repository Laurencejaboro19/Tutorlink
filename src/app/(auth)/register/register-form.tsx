"use client";

import Link from "next/link";
import { ActionForm, FieldError } from "@/components/action-form";
import { Checkbox, Field, Input } from "@/components/ui";
import { registerAction } from "@/server/auth-actions";

export function RegisterForm({ refCode }: { refCode: string }) {
  return (
    <ActionForm action={registerAction} className="mt-6 space-y-4" submitLabel="Create account">
      <Field label="Full name" name="fullName" required>
        <Input id="fullName" name="fullName" autoComplete="name" required placeholder="e.g. Amaka Okafor" />
        <FieldError name="fullName" />
      </Field>
      <Field label="Email address" name="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required placeholder="you@example.com" />
        <FieldError name="email" />
      </Field>
      <Field label="Password" name="password" required help="At least 8 characters with a number.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
        <FieldError name="password" />
      </Field>
      <Field label="Referral code (optional)" name="ref">
        <Input id="ref" name="ref" defaultValue={refCode} placeholder="e.g. 7KQ2MZ9A" className="uppercase" maxLength={16} />
        <FieldError name="ref" />
      </Field>
      <Checkbox
        name="accept"
        label={
          <>
            I am 18 or older (or a parent/guardian booking for a learner) and I accept the{" "}
            <Link href="/terms" className="underline" target="_blank">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline" target="_blank">
              Privacy notice
            </Link>
            .
          </>
        }
      />
      <FieldError name="accept" />
    </ActionForm>
  );
}
