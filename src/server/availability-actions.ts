"use server";

import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { fail, succeed, toActionError, type ActionResult } from "@/lib/result";
import { parseForm } from "@/lib/validation";
import { addAvailabilityWindow, addServiceArea, removeAvailabilityWindow, removeServiceArea } from "@/server/availability";

type R = ActionResult<{ redirectTo?: string }> | null;

const minute = z.coerce
  .number()
  .int()
  .min(0)
  .max(1440)
  .refine((v) => v % 30 === 0, "Use 30-minute steps");

const windowSchema = z.object({
  weekday: z.coerce.number().int().min(0, "Choose a day").max(6, "Choose a day"),
  startMinute: minute,
  endMinute: minute,
  format: z.enum(["physical", "online", "hybrid"], { message: "Choose a format" }),
});

export async function addAvailabilityAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(windowSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    if (parsed.data.endMinute <= parsed.data.startMinute) return fail("End time must be after start time.", { endMinute: ["End time must be after start time"] });
    await addAvailabilityWindow(user.id, parsed.data);
    return succeed(undefined, "Window added.");
  } catch (e) {
    return toActionError(e);
  }
}

const idSchema = z.object({ id: z.coerce.number().int().positive() });

export async function removeAvailabilityAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(idSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await removeAvailabilityWindow(user.id, parsed.data.id);
    return succeed(undefined, "Window removed.");
  } catch (e) {
    return toActionError(e);
  }
}

const areaSchema = z.object({
  stateId: z.coerce.number().int().positive("Select a state"),
  lgaId: z.coerce.number().int().positive("Select an LGA"),
  cityId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v > 0), "Invalid city"),
});

export async function addServiceAreaAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(areaSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await addServiceArea(user.id, parsed.data);
    return succeed(undefined, "Service area added.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeServiceAreaAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(idSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await removeServiceArea(user.id, parsed.data.id);
    return succeed(undefined, "Service area removed.");
  } catch (e) {
    return toActionError(e);
  }
}
