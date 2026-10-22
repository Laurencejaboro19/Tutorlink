"use client";

import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { cancelSubscriptionAction, grantMonthAction, updatePlanAction } from "@/server/admin-actions";
import { AdminForm, FieldError } from "../_components/forms";

export function CancelSubscriptionForm({ subscriptionId }: { subscriptionId: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold text-danger-600 hover:underline">Cancel now…</summary>
      <div className="mt-2 w-72 max-w-full">
        <AdminForm action={cancelSubscriptionAction} hidden={{ subscriptionId }} submitLabel="Cancel immediately" variant="danger" confirm="I understand the tutor loses paid benefits now (no refund is created here).">
          <Field label="Reason (sent to tutor)" name={`reason-${subscriptionId}`}>
            <Input id={`reason-${subscriptionId}`} name="reason" required maxLength={2000} className="!min-h-[40px] text-sm" />
            <FieldError name="reason" />
          </Field>
        </AdminForm>
      </div>
    </details>
  );
}

export function GrantMonthForm() {
  return (
    <AdminForm action={grantMonthAction} hidden={{}} submitLabel="Grant 30 days">
      <Field label="Tutor user id" name="tutorId" required help="Copy it from the user page. The grant starts after any current paid period.">
        <Input id="tutorId" name="tutorId" required placeholder="uuid" />
        <FieldError name="tutorId" />
      </Field>
      <Field label="Plan" name="planCode" required>
        <Select id="planCode" name="planCode" defaultValue="premium">
          <option value="premium">Premium</option>
          <option value="premium_plus">Premium+</option>
        </Select>
      </Field>
      <Field label="Reason" name="reason" required>
        <Textarea id="grant-reason" name="reason" required maxLength={2000} className="!min-h-[80px]" />
        <FieldError name="reason" />
      </Field>
    </AdminForm>
  );
}

export type PlanRow = { code: "free" | "premium" | "premium_plus"; name: string; monthlyFeeNgn: string; commissionPct: string; maxPublishedPackages: number | null; visibilityBoost: string; profileBoostEligible: boolean; analyticsTools: boolean; active: boolean };

export function PlanEditor({ plan }: { plan: PlanRow }) {
  const id = (f: string) => `${plan.code}-${f}`;
  return (
    <AdminForm action={updatePlanAction} hidden={{ code: plan.code }} submitLabel={`Save ${plan.name}`} confirm="I understand new bookings and renewals use these values; historical bookings keep their snapshot.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Monthly fee (NGN)" name={id("fee")}>
          <Input id={id("fee")} name="monthlyFeeNgn" inputMode="decimal" defaultValue={plan.monthlyFeeNgn} required />
          <FieldError name="monthlyFeeNgn" />
        </Field>
        <Field label="Commission %" name={id("commission")}>
          <Input id={id("commission")} name="commissionPct" inputMode="decimal" defaultValue={plan.commissionPct} required />
          <FieldError name="commissionPct" />
        </Field>
        <Field label="Max published packages" name={id("max")} help="Blank = unlimited">
          <Input id={id("max")} name="maxPublishedPackages" inputMode="numeric" defaultValue={plan.maxPublishedPackages ?? ""} />
          <FieldError name="maxPublishedPackages" />
        </Field>
        <Field label="Visibility boost" name={id("boost")} help="Added to rank at search time, shown as 'Promoted'">
          <Input id={id("boost")} name="visibilityBoost" inputMode="decimal" defaultValue={plan.visibilityBoost} required />
          <FieldError name="visibilityBoost" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <Checkbox name="profileBoostEligible" label="Profile boost eligible" defaultChecked={plan.profileBoostEligible} />
        <Checkbox name="analyticsTools" label="Analytics tools" defaultChecked={plan.analyticsTools} />
        <Checkbox name="active" label="Active (purchasable)" defaultChecked={plan.active} />
      </div>
    </AdminForm>
  );
}
