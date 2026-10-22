"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { resetPasswordAction } from "@/server/auth-actions";

export function ResetForm({ token }: { token: string }) {
  return (
    <ActionForm action={resetPasswordAction} className="mt-6 space-y-4" submitLabel="Update password">
      <input type="hidden" name="token" value={token} />
      <Field label="New password" name="password" required help="At least 8 characters with a number.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
        <FieldError name="password" />
      </Field>
    </ActionForm>
  );
}
