"use client";

import { useRouter } from "next/navigation";
import { createContext, useActionState, useContext, useEffect, type ReactNode } from "react";
import type { ActionResult } from "@/lib/result";
import { Alert, Button } from "./ui";

type Result = ActionResult<{ redirectTo?: string; [k: string]: unknown }> | null;

const FormCtx = createContext<{ state: Result; pending: boolean }>({ state: null, pending: false });

export function useFormResult() {
  return useContext(FormCtx);
}

/**
 * Wraps a server action that returns ActionResult. Renders top-level errors,
 * exposes field errors via useFormResult(), and follows `redirectTo` on success.
 */
export function ActionForm({
  action,
  children,
  className,
  submitLabel = "Save",
  submitVariant = "primary",
  successMessage,
  onSuccess,
  hideSubmit,
  resetOnSuccess,
}: {
  action: (prev: Result, formData: FormData) => Promise<Result>;
  children: ReactNode;
  className?: string;
  submitLabel?: ReactNode;
  submitVariant?: "primary" | "secondary" | "outline" | "danger";
  successMessage?: string;
  onSuccess?: (data: unknown) => void;
  hideSubmit?: boolean;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, null);

  useEffect(() => {
    if (state?.ok) {
      const to = state.data?.redirectTo;
      onSuccess?.(state.data);
      if (to) router.push(to);
      else router.refresh();
    }
  }, [state, router, onSuccess]);

  return (
    <FormCtx.Provider value={{ state, pending }}>
      <form action={formAction} className={className} key={resetOnSuccess && state?.ok ? String(Date.now()) : undefined} noValidate>
        {state && !state.ok && (
          <Alert tone="danger" className="mb-4">
            {state.error}
          </Alert>
        )}
        {state?.ok && (successMessage || state.message) && (
          <Alert tone="success" className="mb-4">
            {state.message ?? successMessage}
          </Alert>
        )}
        {children}
        {!hideSubmit && (
          <div className="mt-5">
            <Button type="submit" variant={submitVariant} loading={pending} className="w-full sm:w-auto">
              {submitLabel}
            </Button>
          </div>
        )}
      </form>
    </FormCtx.Provider>
  );
}

export function FieldError({ name }: { name: string }) {
  const { state } = useFormResult();
  const errs = state && !state.ok ? state.fieldErrors?.[name] : undefined;
  if (!errs?.length) return null;
  return (
    <p className="tl-error" role="alert">
      {errs[0]}
    </p>
  );
}

export function SubmitButton({ children, variant = "primary", className, size }: { children: ReactNode; variant?: "primary" | "secondary" | "outline" | "danger" | "ghost"; className?: string; size?: "sm" | "md" | "lg" }) {
  const { pending } = useFormResult();
  return (
    <Button type="submit" variant={variant} loading={pending} className={className} size={size}>
      {children}
    </Button>
  );
}
