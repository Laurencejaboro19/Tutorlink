import "server-only";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { exams, subjects, tutorAvailability, tutorExams, tutorProfiles, tutorQualifications, tutorServiceAreas, tutorSubjects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/result";
import { recomputeTutorRank } from "./ranking";
import type { Tone } from "@/components/ui";

export type TutorProfile = typeof tutorProfiles.$inferSelect;
export type Level = "primary" | "junior_secondary" | "senior_secondary" | "tertiary" | "adult";

export const VERIFICATION: Record<TutorProfile["identityStatus"], { label: string; tone: Tone }> = {
  not_submitted: { label: "Not submitted", tone: "neutral" },
  pending: { label: "Pending review", tone: "warning" },
  verified: { label: "Verified", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  needs_info: { label: "More information needed", tone: "warning" },
};

export const IDENTITY_DOCUMENT_TYPES = [
  { value: "nin", label: "National Identification Number (NIN)" },
  { value: "voters_card", label: "Voter's card" },
  { value: "drivers_licence", label: "Driver's licence" },
  { value: "passport", label: "International passport" },
] as const;

export async function getTutorProfile(tutorId: string) {
  const [profile, subjectRows, examRows, quals] = await Promise.all([
    db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, tutorId) }),
    db.select({ id: subjects.id, name: subjects.name, levels: tutorSubjects.levels }).from(tutorSubjects).innerJoin(subjects, eq(subjects.id, tutorSubjects.subjectId)).where(eq(tutorSubjects.tutorId, tutorId)).orderBy(asc(subjects.name)),
    db.select({ id: tutorExams.examId }).from(tutorExams).where(eq(tutorExams.tutorId, tutorId)),
    db.select().from(tutorQualifications).where(eq(tutorQualifications.tutorId, tutorId)).orderBy(desc(tutorQualifications.createdAt)),
  ]);
  return { profile: profile ?? null, subjects: subjectRows, examIds: examRows.map((e) => e.id), qualifications: quals };
}

export async function updateTutorProfile(
  tutorId: string,
  input: { headline: string | null; bio: string | null; yearsExperience: number; offersPhysical: boolean; offersOnline: boolean; subjectIds: number[]; levels: Level[]; examIds: number[] },
) {
  if (!input.offersPhysical && !input.offersOnline) throw new DomainError("Choose at least one teaching format.");
  await db.transaction(async (tx) => {
    await tx.insert(tutorProfiles).values({ userId: tutorId }).onConflictDoNothing();
    const [before] = await tx.select().from(tutorProfiles).where(eq(tutorProfiles.userId, tutorId)).for("update");
    const validSubjects = input.subjectIds.length ? await tx.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.active, true), inArray(subjects.id, input.subjectIds))) : [];
    const validExams = input.examIds.length ? await tx.select({ id: exams.id }).from(exams).where(and(eq(exams.active, true), inArray(exams.id, input.examIds))) : [];

    // Listing depends on formats: if a tutor drops a format they still need something bookable.
    let isListed = before.isListed;
    if (isListed) {
      const [{ n: areaCount }] = await tx.select({ n: count() }).from(tutorServiceAreas).where(eq(tutorServiceAreas.tutorId, tutorId));
      if (validSubjects.length === 0 || (!input.offersOnline && areaCount === 0)) isListed = false;
    }

    await tx
      .update(tutorProfiles)
      .set({ headline: input.headline, bio: input.bio, yearsExperience: input.yearsExperience, offersPhysical: input.offersPhysical, offersOnline: input.offersOnline, isListed, updatedAt: new Date() })
      .where(eq(tutorProfiles.userId, tutorId));
    await tx.delete(tutorSubjects).where(eq(tutorSubjects.tutorId, tutorId));
    if (validSubjects.length) await tx.insert(tutorSubjects).values(validSubjects.map((s) => ({ tutorId, subjectId: s.id, levels: input.levels })));
    await tx.delete(tutorExams).where(eq(tutorExams.tutorId, tutorId));
    if (validExams.length) await tx.insert(tutorExams).values(validExams.map((e) => ({ tutorId, examId: e.id })));
    await audit({ actorId: tutorId, actorRole: "tutor", action: "tutor_profile.updated", targetType: "tutor", targetId: tutorId, before: { offersPhysical: before.offersPhysical, offersOnline: before.offersOnline, isListed: before.isListed }, after: { offersPhysical: input.offersPhysical, offersOnline: input.offersOnline, isListed, subjects: validSubjects.length } }, tx);
    await recomputeTutorRank(tutorId, tx);
  });
}

export async function addQualification(tutorId: string, input: { title: string; institution: string; yearObtained: number | null; documentRef: string | null }) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(tutorQualifications).values({ tutorId, ...input, status: "pending" }).returning();
    // A new entry re-opens qualification review unless it was already verified.
    await tx.update(tutorProfiles).set({ qualificationStatus: "pending", updatedAt: new Date() }).where(and(eq(tutorProfiles.userId, tutorId), inArray(tutorProfiles.qualificationStatus, ["not_submitted", "rejected", "needs_info"])));
    await audit({ actorId: tutorId, actorRole: "tutor", action: "qualification.added", targetType: "tutor", targetId: tutorId, after: { id: row.id, title: input.title, institution: input.institution } }, tx);
    return row;
  });
}

export async function removeQualification(tutorId: string, id: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.delete(tutorQualifications).where(and(eq(tutorQualifications.id, id), eq(tutorQualifications.tutorId, tutorId))).returning();
    if (!row) throw new DomainError("Qualification not found.");
    const [{ n }] = await tx.select({ n: count() }).from(tutorQualifications).where(eq(tutorQualifications.tutorId, tutorId));
    if (n === 0) await tx.update(tutorProfiles).set({ qualificationStatus: "not_submitted", updatedAt: new Date() }).where(eq(tutorProfiles.userId, tutorId));
    await audit({ actorId: tutorId, actorRole: "tutor", action: "qualification.removed", targetType: "tutor", targetId: tutorId, before: { id: row.id, title: row.title, status: row.status } }, tx);
    await recomputeTutorRank(tutorId, tx);
    return row;
  });
}

/** Tutor submits identity details for admin review. Status always goes to "pending" — never "verified". */
export async function submitIdentity(tutorId: string, input: { documentType: string; documentNumber: string }) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(tutorProfiles).where(eq(tutorProfiles.userId, tutorId)).for("update");
    if (!p) throw new DomainError("Tutor profile not found.");
    if (p.identityStatus === "verified") throw new DomainError("Your identity is already verified.");
    if (p.identityStatus === "pending") throw new DomainError("Your submission is already under review.");
    await tx
      .update(tutorProfiles)
      .set({ identityStatus: "pending", identityDocumentType: input.documentType, identityDocumentRef: input.documentNumber, identityReviewNote: null, updatedAt: new Date() })
      .where(eq(tutorProfiles.userId, tutorId));
    await audit({ actorId: tutorId, actorRole: "tutor", action: "identity.submitted", targetType: "tutor", targetId: tutorId, after: { documentType: input.documentType } }, tx);
  });
}

export type ListingRequirement = { key: string; label: string; met: boolean; href: string; hint: string };

export async function listingRequirements(tutorId: string): Promise<{ requirements: ListingRequirement[]; allMet: boolean; profile: TutorProfile | null }> {
  const profile = await db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, tutorId) });
  if (!profile) return { requirements: [], allMet: false, profile: null };
  const [[{ n: subjectCount }], [{ n: windowCount }], [{ n: areaCount }]] = await Promise.all([
    db.select({ n: count() }).from(tutorSubjects).where(eq(tutorSubjects.tutorId, tutorId)),
    db.select({ n: count() }).from(tutorAvailability).where(eq(tutorAvailability.tutorId, tutorId)),
    db.select({ n: count() }).from(tutorServiceAreas).where(eq(tutorServiceAreas.tutorId, tutorId)),
  ]);
  const requirements: ListingRequirement[] = [
    { key: "identity", label: "Identity verified", met: profile.identityStatus === "verified", href: "/tutor/profile#identity", hint: profile.identityStatus === "pending" ? "Submitted — awaiting admin review." : "Submit your ID details below for review." },
    { key: "subjects", label: "At least one subject", met: subjectCount > 0, href: "/tutor/profile#profile", hint: "Pick the subjects you teach." },
    { key: "availability", label: "At least one availability window", met: windowCount > 0, href: "/tutor/availability", hint: "Students can only book inside your windows." },
    { key: "reach", label: "Online sessions enabled or at least one service area", met: profile.offersOnline || areaCount > 0, href: profile.offersPhysical ? "/tutor/availability" : "/tutor/profile#profile", hint: "Enable online teaching, or add an in-person service area." },
  ];
  return { requirements, allMet: requirements.every((r) => r.met), profile };
}

export async function setListed(tutorId: string, listed: boolean) {
  const { allMet, requirements, profile } = await listingRequirements(tutorId);
  if (!profile) throw new DomainError("Tutor profile not found.");
  if (listed && !allMet) {
    const missing = requirements.filter((r) => !r.met).map((r) => r.label.toLowerCase());
    throw new DomainError(`You cannot list your profile yet. Still needed: ${missing.join("; ")}.`);
  }
  await db.transaction(async (tx) => {
    await tx.update(tutorProfiles).set({ isListed: listed, updatedAt: new Date() }).where(eq(tutorProfiles.userId, tutorId));
    await audit({ actorId: tutorId, actorRole: "tutor", action: listed ? "tutor.listed" : "tutor.unlisted", targetType: "tutor", targetId: tutorId }, tx);
    await recomputeTutorRank(tutorId, tx);
  });
}
