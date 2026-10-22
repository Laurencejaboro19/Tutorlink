import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { exams, packages, subjects, tutorProfiles, tutorSubjects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/result";
import type { Ngn } from "@/lib/money";
import { canPublishAnotherPackage, getActivePlan } from "./plans";
import type { Tone } from "@/components/ui";

export type Package = typeof packages.$inferSelect;

export const PACKAGE_STATUS: Record<Package["status"], { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  published: { label: "Published", tone: "success" },
  unpublished: { label: "Unpublished", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" },
};

export type PackageInput = {
  title: string;
  description: string;
  subjectId: number;
  level: Package["level"];
  examId: number | null;
  format: Package["format"];
  priceNgn: Ngn;
  durationMinutes: number;
  sessionsCount: number;
  outcomes: string[];
  requirements: string | null;
};

/** Business rules shared by create/update: subject must be one the tutor teaches; format must match the profile. */
async function validateAgainstProfile(tutorId: string, input: PackageInput) {
  const profile = await db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, tutorId) });
  if (!profile) throw new DomainError("Set up your tutor profile first.");
  const owned = await db.query.tutorSubjects.findFirst({ where: and(eq(tutorSubjects.tutorId, tutorId), eq(tutorSubjects.subjectId, input.subjectId)) });
  if (!owned) throw new DomainError("Pick a subject from your profile. Add subjects under Profile & verification first.");
  if ((input.format === "physical" || input.format === "hybrid") && !profile.offersPhysical) throw new DomainError("Your profile does not offer in-person sessions. Enable it under Profile & verification or choose Online.");
  if ((input.format === "online" || input.format === "hybrid") && !profile.offersOnline) throw new DomainError("Your profile does not offer online sessions. Enable it under Profile & verification or choose In person.");
  if (input.examId) {
    const ex = await db.query.exams.findFirst({ where: and(eq(exams.id, input.examId), eq(exams.active, true)) });
    if (!ex) throw new DomainError("Choose a valid exam focus.");
  }
}

export async function listTutorPackages(tutorId: string) {
  return db
    .select({ pkg: packages, subject: subjects.name, exam: exams.name })
    .from(packages)
    .innerJoin(subjects, eq(subjects.id, packages.subjectId))
    .leftJoin(exams, eq(exams.id, packages.examId))
    .where(eq(packages.tutorId, tutorId))
    .orderBy(asc(packages.status), desc(packages.updatedAt));
}

export async function getOwnPackage(tutorId: string, packageId: string) {
  const row = await db.query.packages.findFirst({ where: and(eq(packages.id, packageId), eq(packages.tutorId, tutorId)) });
  return row ?? null;
}

export async function createPackage(tutorId: string, input: PackageInput) {
  await validateAgainstProfile(tutorId, input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(packages)
      .values({ tutorId, ...input, status: "draft" })
      .returning();
    await audit({ actorId: tutorId, actorRole: "tutor", action: "package.created", targetType: "package", targetId: row.id, after: { title: input.title, priceNgn: input.priceNgn } }, tx);
    return row;
  });
}

export async function updatePackage(tutorId: string, packageId: string, input: PackageInput) {
  await validateAgainstProfile(tutorId, input);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(packages).where(and(eq(packages.id, packageId), eq(packages.tutorId, tutorId))).for("update");
    if (!existing) throw new DomainError("Package not found.");
    if (existing.status === "archived") throw new DomainError("Archived packages cannot be edited. Create a new one instead.");
    const [row] = await tx
      .update(packages)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(packages.id, existing.id))
      .returning();
    await audit({ actorId: tutorId, actorRole: "tutor", action: "package.updated", targetType: "package", targetId: row.id, before: { priceNgn: existing.priceNgn, title: existing.title }, after: { priceNgn: input.priceNgn, title: input.title } }, tx);
    return row;
  });
}

export async function publishPackage(tutorId: string, packageId: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(packages).where(and(eq(packages.id, packageId), eq(packages.tutorId, tutorId))).for("update");
    if (!existing) throw new DomainError("Package not found.");
    if (existing.status === "published") return existing;
    if (existing.status === "archived") throw new DomainError("Archived packages cannot be published.");
    const cap = await canPublishAnotherPackage(tutorId, tx);
    if (!cap.ok) {
      const { plan } = await getActivePlan(tutorId, tx);
      throw new DomainError(`Your ${plan.name} plan allows ${cap.limit} published package${cap.limit === 1 ? "" : "s"} and you already have ${cap.published}. Unpublish one, or upgrade to Premium for unlimited packages and a lower commission at /tutor/subscription.`, "plan_limit");
    }
    const [row] = await tx.update(packages).set({ status: "published", publishedAt: existing.publishedAt ?? new Date(), updatedAt: new Date() }).where(eq(packages.id, existing.id)).returning();
    await audit({ actorId: tutorId, actorRole: "tutor", action: "package.published", targetType: "package", targetId: row.id }, tx);
    return row;
  });
}

export async function unpublishPackage(tutorId: string, packageId: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(packages).where(and(eq(packages.id, packageId), eq(packages.tutorId, tutorId))).for("update");
    if (!existing) throw new DomainError("Package not found.");
    if (existing.status !== "published") throw new DomainError("Only published packages can be unpublished.");
    const [row] = await tx.update(packages).set({ status: "unpublished", updatedAt: new Date() }).where(eq(packages.id, existing.id)).returning();
    await audit({ actorId: tutorId, actorRole: "tutor", action: "package.unpublished", targetType: "package", targetId: row.id }, tx);
    return row;
  });
}

/** Archive, never delete: existing bookings keep their package reference and price snapshot. */
export async function archivePackage(tutorId: string, packageId: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(packages).where(and(eq(packages.id, packageId), eq(packages.tutorId, tutorId))).for("update");
    if (!existing) throw new DomainError("Package not found.");
    if (existing.status === "archived") return existing;
    const [row] = await tx.update(packages).set({ status: "archived", updatedAt: new Date() }).where(eq(packages.id, existing.id)).returning();
    await audit({ actorId: tutorId, actorRole: "tutor", action: "package.archived", targetType: "package", targetId: row.id, before: { status: existing.status } }, tx);
    return row;
  });
}
