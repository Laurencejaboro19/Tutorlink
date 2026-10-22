"use client";

import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { LocationPicker } from "@/components/location-picker";
import { Field, Select } from "@/components/ui";
import { addAvailabilityAction, addServiceAreaAction, removeAvailabilityAction, removeServiceAreaAction } from "@/server/availability-actions";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function label(m: number) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (m === 1440) return "12:00 am (midnight)";
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

export function AddWindowForm({ formats }: { formats: { physical: boolean; online: boolean } }) {
  const steps = Array.from({ length: 49 }, (_, i) => i * 30);
  return (
    <ActionForm action={addAvailabilityAction} submitLabel="Add window" resetOnSuccess className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Day" name="weekday" required>
        <Select id="weekday" name="weekday" defaultValue="1" required>
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </Select>
        <FieldError name="weekday" />
      </Field>
      <Field label="From" name="startMinute" required>
        <Select id="startMinute" name="startMinute" defaultValue="540" required>
          {steps.slice(0, -1).map((m) => (
            <option key={m} value={m}>
              {label(m)}
            </option>
          ))}
        </Select>
        <FieldError name="startMinute" />
      </Field>
      <Field label="To" name="endMinute" required>
        <Select id="endMinute" name="endMinute" defaultValue="720" required>
          {steps.slice(1).map((m) => (
            <option key={m} value={m}>
              {label(m)}
            </option>
          ))}
        </Select>
        <FieldError name="endMinute" />
      </Field>
      <Field label="Format" name="format" required>
        <Select id="format" name="format" defaultValue={formats.physical && formats.online ? "hybrid" : formats.online ? "online" : "physical"} required>
          {formats.physical && formats.online && <option value="hybrid">In person or online</option>}
          {formats.online && <option value="online">Online only</option>}
          {formats.physical && <option value="physical">In person only</option>}
        </Select>
        <FieldError name="format" />
      </Field>
    </ActionForm>
  );
}

export function RemoveWindowButton({ id }: { id: number }) {
  return (
    <ActionForm action={removeAvailabilityAction} hideSubmit>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm">
        Remove
      </SubmitButton>
    </ActionForm>
  );
}

export function AddAreaForm({ states }: { states: { id: number; name: string }[] }) {
  return (
    <ActionForm action={addServiceAreaAction} submitLabel="Add area" resetOnSuccess>
      <LocationPicker states={states} required cityOptional labels={{ stateId: "State", lgaId: "LGA", cityId: "City / town (optional)" }} />
      <p className="tl-help">Leave the city blank to cover the whole LGA.</p>
    </ActionForm>
  );
}

export function RemoveAreaButton({ id }: { id: number }) {
  return (
    <ActionForm action={removeServiceAreaAction} hideSubmit>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm">
        Remove
      </SubmitButton>
    </ActionForm>
  );
}
