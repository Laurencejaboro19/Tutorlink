"use client";

import type { ReactNode } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { Checkbox } from "@/components/ui";
import type { ActionResult } from "@/lib/result";

type Result = ActionResult<{ redirectTo?: string; [k: string]: unknown }> | null;
export type AdminAction = (prev: Result, formData: FormData) => Promise<Result>;

/**
 * Small action form for admin pages: hidden ids + optional inputs + optional
 * "I understand" confirmation for destructive actions.
 */
export function AdminForm({
  action,
  hidden,
  children,
  submitLabel,
  variant = "primary",
  confirm,
  className,
  inline,
}: {
  action: AdminAction;
  hidden: Record<string, string>;
  children?: ReactNode;
  submitLabel: ReactNode;
  variant?: "primary" | "secondary" | "outline" | "danger";
  /** Text shown next to the confirmation checkbox; when set the action requires it. */
  confirm?: string;
  className?: string;
  inline?: boolean;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} submitVariant={variant} className={className ?? (inline ? "flex flex-col gap-2" : "space-y-3")} resetOnSuccess>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      {confirm && (
        <div>
          <Checkbox name="confirm" label={confirm} />
          <FieldError name="confirm" />
        </div>
      )}
    </ActionForm>
  );
}

export { FieldError };
