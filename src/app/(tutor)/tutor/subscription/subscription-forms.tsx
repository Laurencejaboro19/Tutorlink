"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Button, Checkbox } from "@/components/ui";
import { cancelSubscriptionAction, startSubscriptionAction } from "@/server/subscription-actions";

export function StartPlanForm({ plan, label, disabled, reason, variant = "primary" }: { plan: "premium" | "premium_plus"; label: string; disabled?: boolean; reason?: string; variant?: "primary" | "outline" | "secondary" }) {
  if (disabled) {
    return (
      <div>
        <Button type="button" variant={variant} className="w-full" disabled aria-describedby={`${plan}-why`}>
          {label}
        </Button>
        {reason && (
          <p id={`${plan}-why`} className="mt-2 text-xs text-ink-500">
            {reason}
          </p>
        )}
      </div>
    );
  }
  return (
    <ActionForm action={startSubscriptionAction} hideSubmit>
      <input type="hidden" name="plan" value={plan} />
      <Button type="submit" variant={variant} className="w-full">
        {label}
      </Button>
      {reason && <p className="mt-2 text-xs text-ink-500">{reason}</p>}
    </ActionForm>
  );
}

export function CancelPlanForm({ subscriptionId, endsAtLabel }: { subscriptionId: string; endsAtLabel: string }) {
  return (
    <ActionForm action={cancelSubscriptionAction} submitLabel="Cancel renewal" submitVariant="outline" className="space-y-3">
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <Checkbox name="confirm" label={`I understand my plan benefits continue until ${endsAtLabel}, after which I return to the Free plan. My packages and history are not removed.`} />
      <FieldError name="confirm" />
    </ActionForm>
  );
}
