"use client";

import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import { cancelPayoutRequestAction, requestPayoutAction, saveBankDetailsAction } from "@/server/payout-actions";

export function BankDetailsForm({ banks, current }: { banks: { code: string; name: string }[]; current: { bankCode: string; accountLast4: string; accountName: string } | null }) {
  return (
    <ActionForm action={saveBankDetailsAction} className="space-y-4" submitLabel={current ? "Update bank details" : "Save bank details"} submitVariant={current ? "outline" : "primary"} resetOnSuccess>
      <Field label="Bank" name="bankCode" required>
        <Select id="bankCode" name="bankCode" defaultValue={current?.bankCode ?? ""} required>
          <option value="" disabled>
            Choose your bank
          </option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </Select>
        <FieldError name="bankCode" />
      </Field>
      <Field label="Account number (NUBAN)" name="accountNumber" required help={current ? `Saved account ends in ${current.accountLast4}. Enter the full 10 digits again to change it.` : "10 digits. Stored encrypted; only the last 4 digits are shown afterwards."}>
        <Input id="accountNumber" name="accountNumber" inputMode="numeric" pattern="\d{10}" minLength={10} maxLength={10} autoComplete="off" placeholder="0123456789" required />
        <FieldError name="accountNumber" />
      </Field>
      <Field label="Account name" name="accountName" required help="Exactly as your bank has it. Transfers to a mismatched name are rejected by the bank.">
        <Input id="accountName" name="accountName" defaultValue={current?.accountName ?? ""} maxLength={120} required />
        <FieldError name="accountName" />
      </Field>
    </ActionForm>
  );
}

export function RequestPayoutForm({ requestable, min, disabledReason }: { requestable: string; min: string; disabledReason?: string }) {
  if (disabledReason) {
    return <p className="text-sm text-ink-500">{disabledReason}</p>;
  }
  return (
    <ActionForm action={requestPayoutAction} className="space-y-4" submitLabel="Request payout" resetOnSuccess>
      <Field label="Amount (₦)" name="amount" required help={`Between ₦${Number(min).toLocaleString("en-NG")} and ₦${Number(requestable).toLocaleString("en-NG")}.`}>
        <Input id="amount" name="amount" inputMode="decimal" defaultValue={requestable} required />
        <FieldError name="amount" />
      </Field>
    </ActionForm>
  );
}

export function CancelPayoutForm({ payoutId }: { payoutId: string }) {
  return (
    <ActionForm action={cancelPayoutRequestAction} hideSubmit>
      <input type="hidden" name="payoutId" value={payoutId} />
      <SubmitButton variant="ghost" size="sm">
        Withdraw
      </SubmitButton>
    </ActionForm>
  );
}
