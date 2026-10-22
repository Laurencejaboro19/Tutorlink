"use client";

import { ActionForm, FieldError, useFormResult } from "@/components/action-form";
import { Alert, Field, Input } from "@/components/ui";
import { forgotPasswordAction } from "@/server/auth-actions";

function DebugLink() {
  const { state } = useFormResult();
  const link = state?.ok ? (state.data as { debugLink?: string } | undefined)?.debugLink : undefined;
  if (!link) return null;
  return (
    <Alert tone="warning" title="Email delivery is not configured on this deployment" className="mt-4">
      Use this link instead: <a className="break-all underline" href={link}>{link}</a>
    </Alert>
  );
}

export function ForgotForm() {
  return (
    <ActionForm action={forgotPasswordAction} className="mt-6 space-y-4" submitLabel="Send reset link">
      <Field label="Email address" name="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required />
        <FieldError name="email" />
      </Field>
      <DebugLink />
    </ActionForm>
  );
}
