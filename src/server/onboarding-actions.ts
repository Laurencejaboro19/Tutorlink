"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { subjects, tutorProfiles, tutorSubjects, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { fail, succeed, toActionError, type ActionResult } from "@/lib/result";
import { parseForm, phoneSchema } from "@/lib/validation";
import { onOnboardingComplete } from "@/server/referrals";
import { locationSchema, resolveLocation } from "@/server/locations";

type R = ActionResult<{ redirectTo?: string }> | null;

export async function setLocationAction(_prev: R, formData: FormData): Promise<R> {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in first.");
  const parsed = parseForm(locationSchema, formData);
  if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
  const loc = await resolveLocation(parsed.data);
  if (!loc) return fail("That location could not be matched. Pick state, LGA and city again.");
  try {
    await db
      .update(users)
      .set({
        stateId: loc.stateId,
        lgaId: loc.lgaId,
        cityId: loc.cityId,
        onboardingStep: user.onboardingStep === "location" || user.onboardingStep === "verify_email" ? "role" : user.onboardingStep,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    return succeed({ redirectTo: user.onboardingStep === "complete" ? "/account" : "/onboarding" });
  } catch (e) {
    return toActionError(e);
  }
}

const roleSchema = z.object({ role: z.enum(["student", "tutor", "both"]) });

export async function setRoleAction(_prev: R, formData: FormData): Promise<R> {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in first.");
  const parsed = parseForm(roleSchema, formData);
  if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
  const role = parsed.data.role;
  const isStudent = role !== "tutor";
  const isTutor = role !== "student";
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ isStudent: user.isStudent || isStudent, isTutor: user.isTutor || isTutor, onboardingStep: user.onboardingStep === "role" ? "profile" : user.onboardingStep, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      if (isTutor) {
        await tx.insert(tutorProfiles).values({ userId: user.id }).onConflictDoNothing();
      }
      await audit({ actorId: user.id, action: "onboarding.role", targetType: "user", targetId: user.id, after: { role } }, tx);
    });
    return succeed({ redirectTo: user.onboardingStep === "complete" ? (isTutor ? "/tutor/profile" : "/dashboard") : "/onboarding" });
  } catch (e) {
    return toActionError(e);
  }
}

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  phone: phoneSchema,
  headline: z.string().trim().max(120).optional().or(z.literal("")),
  bio: z.string().trim().max(2000).optional().or(z.literal("")),
  offersPhysical: z.string().optional(),
  offersOnline: z.string().optional(),
  subjectIds: z.array(z.coerce.number().int()).optional(),
  levels: z.array(z.enum(["primary", "junior_secondary", "senior_secondary", "tertiary", "adult"])).optional(),
});

export async function completeProfileAction(_prev: R, formData: FormData): Promise<R> {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in first.");
  const parsed = parseForm(profileSchema, formData);
  if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
  const d = parsed.data;
  if (user.isTutor) {
    if (!d.offersPhysical && !d.offersOnline) return fail("Choose at least one teaching format.", { offersOnline: ["Choose at least one"] });
    if (!d.subjectIds?.length) return fail("Pick at least one subject you teach.", { subjectIds: ["Pick at least one subject"] });
    if (!d.levels?.length) return fail("Pick at least one academic level.", { levels: ["Pick at least one level"] });
    if (!d.bio || d.bio.length < 40) return fail("Write a short bio (at least 40 characters) so students know who you are.", { bio: ["At least 40 characters"] });
  }
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ displayName: d.displayName, phone: d.phone, onboardingStep: "complete", updatedAt: new Date() })
        .where(eq(users.id, user.id));
      if (user.isTutor) {
        await tx.insert(tutorProfiles).values({ userId: user.id }).onConflictDoNothing();
        await tx
          .update(tutorProfiles)
          .set({ headline: d.headline || null, bio: d.bio || null, offersPhysical: !!d.offersPhysical, offersOnline: !!d.offersOnline, updatedAt: new Date() })
          .where(eq(tutorProfiles.userId, user.id));
        const valid = await tx.query.subjects.findMany({ where: eq(subjects.active, true) });
        const validIds = new Set(valid.map((s) => s.id));
        await tx.delete(tutorSubjects).where(eq(tutorSubjects.tutorId, user.id));
        const rows = (d.subjectIds ?? []).filter((id) => validIds.has(id)).map((subjectId) => ({ tutorId: user.id, subjectId, levels: d.levels ?? [] }));
        if (rows.length) await tx.insert(tutorSubjects).values(rows);
      }
      await audit({ actorId: user.id, action: "onboarding.complete", targetType: "user", targetId: user.id }, tx);
    });
    await onOnboardingComplete(user.id, { isStudent: user.isStudent, isTutor: user.isTutor });
    return succeed({ redirectTo: user.isStudent ? "/dashboard" : "/tutor" });
  } catch (e) {
    return toActionError(e);
  }
}
