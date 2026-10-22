"use client";

import Link from "next/link";
import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { loginAction } from "@/server/auth-actions";

export function LoginForm({ next }: { next: string }) {
  return (
    <ActionForm action={loginAction} className="mt-6 space-y-4" submitLabel="Sign in">
      <input type="hidden" name="next" value={next} />
      <Field label="Email address" name="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
        <FieldError name="email" />
      </Field>
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="tl-label">
            Password
          </label>
          <Link href="/forgot-password" className="mb-1.5 text-xs font-medium text-brand-600 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
        <FieldError name="password" />
      </div>
    </ActionForm>
  );
}
