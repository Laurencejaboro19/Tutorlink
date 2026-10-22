"use server";

import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { fail, succeed, toActionError, type ActionResult } from "@/lib/result";
import { parseForm, uuidSchema } from "@/lib/validation";
import { addQualification, IDENTITY_DOCUMENT_TYPES, removeQualification, setListed, submitIdentity, updateTutorProfile } from "@/server/tutor-profile";

type R = ActionResult<{ redirectTo?: string }> | null;

const profileSchema = z.object({
  headline: z.string().trim().max(120, "Keep the headline under 120 characters").optional().or(z.literal("")),
  bio: z.string().trim().min(40, "Write at least 40 characters so students know who you are").max(2000),
  yearsExperience: z.coerce.number().int().min(0, "Enter 0 or more").max(60, "Enter a realistic number"),
  offersPhysical: z.string().optional(),
  offersOnline: z.string().optional(),
  subjectIds: z.array(z.coerce.number().int().positive()).optional(),
  levels: z.array(z.enum(["primary", "junior_secondary", "senior_secondary", "tertiary", "adult"])).optional(),
  examIds: z.array(z.coerce.number().int().positive()).optional(),
});

export async function updateTutorProfileAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(profileSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    const d = parsed.data;
    if (!d.offersPhysical && !d.offersOnline) return fail("Choose at least one teaching format.", { offersOnline: ["Choose at least one"] });
    if (!d.subjectIds?.length) return fail("Pick at least one subject you teach.", { subjectIds: ["Pick at least one subject"] });
    if (!d.levels?.length) return fail("Pick at least one academic level.", { levels: ["Pick at least one level"] });
    await updateTutorProfile(user.id, {
      headline: d.headline || null,
      bio: d.bio,
      yearsExperience: d.yearsExperience,
      offersPhysical: !!d.offersPhysical,
      offersOnline: !!d.offersOnline,
      subjectIds: d.subjectIds,
      levels: d.levels,
      examIds: d.examIds ?? [],
    });
    return succeed(undefined, "Profile saved.");
  } catch (e) {
    return toActionError(e);
  }
}

const qualificationSchema = z.object({
  title: z.string().trim().min(3, "Enter the qualification title").max(160),
  institution: z.string().trim().min(2, "Enter the institution").max(160),
  yearObtained: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1950 && v <= new Date().getFullYear()), "Enter a valid year"),
  documentRef: z.string().trim().max(300).optional().or(z.literal("")),
});

export async function addQualificationAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(qualificationSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await addQualification(user.id, { ...parsed.data, documentRef: parsed.data.documentRef || null });
    return succeed(undefined, "Qualification added and queued for review.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeQualificationAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(z.object({ id: uuidSchema }), formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await removeQualification(user.id, parsed.data.id);
    return succeed(undefined, "Qualification removed.");
  } catch (e) {
    return toActionError(e);
  }
}

const identitySchema = z.object({
  documentType: z.enum(IDENTITY_DOCUMENT_TYPES.map((d) => d.value) as [string, ...string[]], { message: "Choose a document type" }),
  documentNumber: z
    .string()
    .trim()
    .min(6, "Enter the full document number")
    .max(40)
    .regex(/^[A-Za-z0-9\-\/ ]+$/, "Letters, numbers, dashes and slashes only"),
  consent: z.string().optional(),
});

export async function submitIdentityAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(identitySchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    if (!parsed.data.consent) return fail("Confirm that the details are yours and accurate.", { consent: ["Required"] });
    await submitIdentity(user.id, { documentType: parsed.data.documentType, documentNumber: parsed.data.documentNumber });
    return succeed(undefined, "Submitted for review. We will notify you when it is checked.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function setListedAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const listed = formData.get("listed") === "1";
    await setListed(user.id, listed);
    return succeed(undefined, listed ? "Your profile is now listed in search." : "Your profile is hidden from search. Existing bookings are unaffected.");
  } catch (e) {
    return toActionError(e);
  }
}
