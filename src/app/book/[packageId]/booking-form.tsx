"use client";

import { useMemo, useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { LocationPicker } from "@/components/location-picker";
import { Alert, Card, CardHeader, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { formatNgn } from "@/lib/money";
import { createBookingAction } from "@/server/booking-actions";
import type { DaySlots } from "@/server/booking-queries";

type Quote = { price: string; creditBalance: string; creditApplied: string; amountDueWithCredits: string; amountDueWithoutCredits: string; maxPct: number };

export function BookingForm({
  packageId,
  canPhysical,
  canOnline,
  states,
  studentLocation,
  slots,
  maxDays,
  quote,
}: {
  packageId: string;
  canPhysical: boolean;
  canOnline: boolean;
  states: { id: number; name: string }[];
  studentLocation: { stateId: number | null; lgaId: number | null; cityId: number | null };
  slots: { physical: DaySlots[]; online: DaySlots[] };
  maxDays: number;
  quote: Quote;
}) {
  const [format, setFormat] = useState<"physical" | "online">(canOnline ? "online" : "physical");
  const days = format === "physical" ? slots.physical : slots.online;
  const [day, setDay] = useState<string>(days[0]?.day ?? "");
  const [startsAt, setStartsAt] = useState<string>("");
  const [useCredits, setUseCredits] = useState(false);
  const hasCredits = Number(quote.creditBalance) > 0;
  const amountDue = useCredits && hasCredits ? quote.amountDueWithCredits : quote.amountDueWithoutCredits;
  const dayEntry = useMemo(() => days.find((d) => d.day === day) ?? days[0], [days, day]);

  const switchFormat = (f: "physical" | "online") => {
    setFormat(f);
    const list = f === "physical" ? slots.physical : slots.online;
    setDay(list[0]?.day ?? "");
    setStartsAt("");
  };

  return (
    <ActionForm action={createBookingAction} submitLabel={Number(amountDue) > 0 ? `Confirm and pay ${formatNgn(amountDue)}` : "Confirm booking"} className="space-y-6">
      <input type="hidden" name="packageId" value={packageId} />
      <input type="hidden" name="startsAt" value={startsAt} />

      <Card>
        <CardHeader title="1. Format" />
        <div className="px-5 pb-5">
          <fieldset>
            <legend className="sr-only">Session format</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {canOnline && (
                <label className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-4 ${format === "online" ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:border-ink-300"}`}>
                  <input type="radio" name="format" value="online" checked={format === "online"} onChange={() => switchFormat("online")} className="mt-1 accent-brand-600" />
                  <span>
                    <span className="block font-semibold text-ink-900">Online</span>
                    <span className="block text-sm text-ink-600">Video call. The tutor shares a meeting link after confirmation.</span>
                  </span>
                </label>
              )}
              {canPhysical && (
                <label className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-4 ${format === "physical" ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:border-ink-300"}`}>
                  <input type="radio" name="format" value="physical" checked={format === "physical"} onChange={() => switchFormat("physical")} className="mt-1 accent-brand-600" />
                  <span>
                    <span className="block font-semibold text-ink-900">In person</span>
                    <span className="block text-sm text-ink-600">At your home or an agreed place inside the tutor&apos;s service area.</span>
                  </span>
                </label>
              )}
            </div>
            <FieldError name="format" />
          </fieldset>

          {format === "physical" && (
            <div className="mt-5 space-y-4">
              <p className="text-sm text-ink-700">Where will the session take place?</p>
              <LocationPicker states={states} initial={studentLocation} required cityOptional />
              <Field label="Address note" name="addressNote" help="Street, landmark or estate. Shared with the tutor only after payment is confirmed.">
                <Input id="addressNote" name="addressNote" maxLength={300} placeholder="e.g. 12 Adeola Odeku St, near the bank" />
                <FieldError name="addressNote" />
              </Field>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="2. Date & time" description={`Only times inside the tutor's availability for the next ${maxDays} days are shown, in West Africa Time.`} />
        <div className="px-5 pb-5">
          {days.length === 0 ? (
            <Alert tone="warning" title="No open slots">
              The tutor has no free {format === "physical" ? "in-person" : "online"} slots in the next {maxDays} days.{" "}
              {canPhysical && canOnline ? "Try the other format or another tutor." : "Try another tutor."}
            </Alert>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" name="day" required>
                <Select
                  id="day"
                  value={dayEntry?.day ?? ""}
                  onChange={(e) => {
                    setDay(e.target.value);
                    setStartsAt("");
                  }}
                >
                  {days.map((d) => (
                    <option key={d.day} value={d.day}>
                      {d.label} ({d.starts.length} slot{d.starts.length === 1 ? "" : "s"})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Start time" name="startTime" required>
                <Select id="startTime" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required>
                  <option value="">Choose a time</option>
                  {(dayEntry?.starts ?? []).map((s) => (
                    <option key={s.iso} value={s.iso}>
                      {s.label}
                    </option>
                  ))}
                </Select>
                <FieldError name="startsAt" />
              </Field>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="3. Notes & payment" />
        <div className="space-y-4 px-5 pb-5">
          <Field label="Note for the tutor" name="studentNote" help="Optional: topics you want to cover, exam date, current level.">
            <Textarea id="studentNote" name="studentNote" maxLength={1000} className="min-h-[90px]" />
            <FieldError name="studentNote" />
          </Field>

          <div className="rounded-[var(--radius-md)] border border-ink-200 bg-ink-50 p-4">
            <h3 className="text-sm font-semibold text-ink-900">Price breakdown</h3>
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-600">Package price</dt>
                <dd className="text-ink-900">{formatNgn(quote.price)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-600">Credits available</dt>
                <dd className="text-ink-900">{formatNgn(quote.creditBalance)}</dd>
              </div>
              {hasCredits && (
                <div className="py-1">
                  <Checkbox name="useCredits" value="1" checked={useCredits} onChange={(e) => setUseCredits(e.target.checked)} label={`Use my credits (up to ${quote.maxPct}% of the price: ${formatNgn(quote.creditApplied)})`} />
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-600">Credits applied</dt>
                <dd className="text-ink-900">− {formatNgn(useCredits && hasCredits ? quote.creditApplied : "0")}</dd>
              </div>
              <div className="flex justify-between border-t border-ink-200 pt-2 text-base font-bold">
                <dt className="text-ink-900">Amount due</dt>
                <dd className="text-ink-900">{formatNgn(amountDue)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-ink-500">Platform commission is handled on the tutor side — you never pay more than the package price. {Number(amountDue) > 0 ? "You will be taken to secure Flutterwave checkout." : "Your credits cover the full price; the session will be confirmed immediately."}</p>
          </div>
        </div>
      </Card>
    </ActionForm>
  );
}
