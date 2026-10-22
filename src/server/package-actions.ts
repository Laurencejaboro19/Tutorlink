"use server";

import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { toKobo } from "@/lib/money";
import { fail, succeed, toActionError, type ActionResult } from "@/lib/result";
import { moneySchema, parseForm, uuidSchema } from "@/lib/validation";
import { archivePackage, createPackage, publishPackage, unpublishPackage, updatePackage, type PackageInput } from "@/server/packages";

type R = ActionResult<{ redirectTo?: string }> | null;

const packageSchema = z.object({
  title: z.string().trim().min(5, "Title must be at least 5 characters").max(120, "Title must be 120 characters or fewer"),
  description: z.string().trim().min(40, "Describe the package in at least 40 characters").max(3000, "Description must be 3000 characters or fewer"),
  subjectId: z.coerce.number().int().positive("Choose a subject"),
  level: z.enum(["primary", "junior_secondary", "senior_secondary", "tertiary", "adult"], { message: "Choose a level" }),
  examId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v > 0), "Choose a valid exam"),
  format: z.enum(["physical", "online", "hybrid"], { message: "Choose a format" }),
  priceNgn: moneySchema.refine((v) => toKobo(v) >= 50_000n && toKobo(v) <= 50_000_000n, "Price must be between ₦500 and ₦500,000"),
  durationMinutes: z.coerce
    .number()
    .int()
    .min(30, "Minimum 30 minutes")
    .max(480, "Maximum 8 hours")
    .refine((v) => v % 15 === 0, "Use 15-minute steps"),
  sessionsCount: z.coerce.number().int().min(1, "At least 1 session").max(20, "At most 20 sessions"),
  outcomes: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    )
    .refine((arr) => arr.length <= 8, "List at most 8 outcomes")
    .refine((arr) => arr.every((l) => l.length <= 160), "Keep each outcome under 160 characters"),
  requirements: z.string().trim().max(1000).optional().or(z.literal("")),
});

function toInput(d: z.infer<typeof packageSchema>): PackageInput {
  return {
    title: d.title,
    description: d.description,
    subjectId: d.subjectId,
    level: d.level,
    examId: d.examId,
    format: d.format,
    priceNgn: d.priceNgn,
    durationMinutes: d.durationMinutes,
    sessionsCount: d.sessionsCount,
    outcomes: d.outcomes,
    requirements: d.requirements || null,
  };
}

export async function createPackageAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(packageSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    const row = await createPackage(user.id, toInput(parsed.data));
    return succeed({ redirectTo: `/tutor/packages/${row.id}/edit?created=1` });
  } catch (e) {
    return toActionError(e);
  }
}

export async function updatePackageAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const id = String(formData.get("packageId") ?? "");
    if (!uuidSchema.safeParse(id).success) return fail("Package not found.");
    const parsed = parseForm(packageSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await updatePackage(user.id, id, toInput(parsed.data));
    return succeed(undefined, "Package saved.");
  } catch (e) {
    return toActionError(e);
  }
}

const idSchema = z.object({ packageId: uuidSchema });

export async function publishPackageAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(idSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await publishPackage(user.id, parsed.data.packageId);
    return succeed(undefined, "Package published. Students can now book it.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function unpublishPackageAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(idSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await unpublishPackage(user.id, parsed.data.packageId);
    return succeed(undefined, "Package unpublished. Existing bookings are unaffected.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function archivePackageAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(idSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await archivePackage(user.id, parsed.data.packageId);
    return succeed({ redirectTo: "/tutor/packages" }, "Package archived.");
  } catch (e) {
    return toActionError(e);
  }
}
