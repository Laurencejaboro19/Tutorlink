"use client";

import { Input, Select } from "@/components/ui";
import { updateSettingAction } from "@/server/admin-actions";
import { AdminForm, FieldError } from "../_components/forms";

export function SettingForm({ setting }: { setting: { key: string; type: "number" | "boolean" | "string"; value: unknown; defaultValue: unknown } }) {
  const id = `s-${setting.key.replaceAll(".", "-")}`;
  return (
    <AdminForm action={updateSettingAction} hidden={{ key: setting.key }} submitLabel="Save" variant="outline" inline className="flex flex-col gap-2 sm:w-64">
      <label htmlFor={id} className="sr-only">
        Value for {setting.key}
      </label>
      {setting.type === "boolean" ? (
        <Select id={id} name="value" defaultValue={setting.value ? "true" : "false"} className="!min-h-[40px] text-sm">
          <option value="true">On (true)</option>
          <option value="false">Off (false)</option>
        </Select>
      ) : setting.key === "payments.refund_fee_policy" ? (
        <Select id={id} name="value" defaultValue={String(setting.value)} className="!min-h-[40px] text-sm">
          <option value="platform_absorbs">platform_absorbs</option>
          <option value="deduct_from_refund">deduct_from_refund</option>
        </Select>
      ) : (
        <Input id={id} name="value" type={setting.type === "number" ? "number" : "text"} step="any" defaultValue={String(setting.value)} className="!min-h-[40px] text-sm" />
      )}
      <FieldError name="value" />
    </AdminForm>
  );
}
