"use client";

import { Input } from "@/components/ui";
import { reverseCreditAction, setReferralFlagAction } from "@/server/admin-actions";
import { AdminForm, FieldError } from "../_components/forms";

export function FlagForm({ referralId, flagged }: { referralId: string; flagged: boolean }) {
  if (flagged) return <AdminForm action={setReferralFlagAction} hidden={{ referralId, flagged: "no" }} submitLabel="Unflag" variant="outline" inline />;
  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold text-danger-600 hover:underline">Flag…</summary>
      <AdminForm action={setReferralFlagAction} hidden={{ referralId, flagged: "yes" }} submitLabel="Flag referral" variant="danger" inline className="mt-2 flex w-64 flex-col gap-2">
        <Input name="reason" placeholder="Reason" aria-label="Flag reason" required className="!min-h-[40px] text-sm" />
        <FieldError name="reason" />
      </AdminForm>
    </details>
  );
}

export function ReverseMilestoneForm({ entryId }: { entryId: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold text-danger-600 hover:underline">Reverse credit…</summary>
      <AdminForm action={reverseCreditAction} hidden={{ entryId }} submitLabel="Reverse" variant="danger" inline className="mt-2 flex w-64 flex-col gap-2" confirm="I understand this deducts the credit from the referrer.">
        <Input name="reason" placeholder="Reason" aria-label="Reversal reason" required className="!min-h-[40px] text-sm" />
        <FieldError name="reason" />
      </AdminForm>
    </details>
  );
}
