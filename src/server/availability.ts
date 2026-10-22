import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { cities, lgas, states, tutorAvailability, tutorServiceAreas } from "@/db/schema";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/result";

export const MAX_SERVICE_AREAS = 20;

export async function listAvailability(tutorId: string) {
  return db.select().from(tutorAvailability).where(eq(tutorAvailability.tutorId, tutorId)).orderBy(asc(tutorAvailability.weekday), asc(tutorAvailability.startMinute));
}

export async function addAvailabilityWindow(tutorId: string, input: { weekday: number; startMinute: number; endMinute: number; format: "physical" | "online" | "hybrid" }) {
  if (input.endMinute <= input.startMinute) throw new DomainError("End time must be after start time.");
  if (input.endMinute - input.startMinute < 30) throw new DomainError("Windows must be at least 30 minutes long.");
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(tutorAvailability).where(and(eq(tutorAvailability.tutorId, tutorId), eq(tutorAvailability.weekday, input.weekday))).for("update");
    const clash = existing.find((w) => (w.format === "hybrid" || input.format === "hybrid" || w.format === input.format) && w.startMinute < input.endMinute && w.endMinute > input.startMinute);
    if (clash) throw new DomainError("That window overlaps an existing one on the same day. Delete or shorten it first.");
    const [row] = await tx.insert(tutorAvailability).values({ tutorId, ...input }).returning();
    await audit({ actorId: tutorId, actorRole: "tutor", action: "availability.added", targetType: "tutor", targetId: tutorId, after: input }, tx);
    return row;
  });
}

export async function removeAvailabilityWindow(tutorId: string, id: number) {
  const [row] = await db.delete(tutorAvailability).where(and(eq(tutorAvailability.id, id), eq(tutorAvailability.tutorId, tutorId))).returning();
  if (!row) throw new DomainError("Window not found.");
  await audit({ actorId: tutorId, actorRole: "tutor", action: "availability.removed", targetType: "tutor", targetId: tutorId, before: row });
  return row;
}

export async function listServiceAreas(tutorId: string) {
  return db
    .select({ id: tutorServiceAreas.id, stateId: tutorServiceAreas.stateId, lgaId: tutorServiceAreas.lgaId, cityId: tutorServiceAreas.cityId, state: states.name, lga: lgas.name, city: cities.name })
    .from(tutorServiceAreas)
    .innerJoin(lgas, eq(lgas.id, tutorServiceAreas.lgaId))
    .innerJoin(states, eq(states.id, tutorServiceAreas.stateId))
    .leftJoin(cities, eq(cities.id, tutorServiceAreas.cityId))
    .where(eq(tutorServiceAreas.tutorId, tutorId))
    .orderBy(asc(states.name), asc(lgas.name), asc(cities.name));
}

export async function addServiceArea(tutorId: string, input: { stateId: number; lgaId: number; cityId: number | null }) {
  const lga = await db.query.lgas.findFirst({ where: and(eq(lgas.id, input.lgaId), eq(lgas.stateId, input.stateId)) });
  if (!lga) throw new DomainError("That LGA is not in the selected state.");
  if (input.cityId) {
    const city = await db.query.cities.findFirst({ where: and(eq(cities.id, input.cityId), eq(cities.lgaId, lga.id)) });
    if (!city) throw new DomainError("That city is not in the selected LGA.");
  }
  return db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(tutorServiceAreas).where(eq(tutorServiceAreas.tutorId, tutorId));
    if (n >= MAX_SERVICE_AREAS) throw new DomainError(`You can list up to ${MAX_SERVICE_AREAS} service areas. Remove one first.`);
    const [row] = await tx
      .insert(tutorServiceAreas)
      .values({ tutorId, stateId: lga.stateId, lgaId: lga.id, cityId: input.cityId })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new DomainError("You already cover that area.");
    await audit({ actorId: tutorId, actorRole: "tutor", action: "service_area.added", targetType: "tutor", targetId: tutorId, after: row }, tx);
    return row;
  });
}

export async function removeServiceArea(tutorId: string, id: number) {
  const [row] = await db.delete(tutorServiceAreas).where(and(eq(tutorServiceAreas.id, id), eq(tutorServiceAreas.tutorId, tutorId))).returning();
  if (!row) throw new DomainError("Service area not found.");
  await audit({ actorId: tutorId, actorRole: "tutor", action: "service_area.removed", targetType: "tutor", targetId: tutorId, before: row });
  return row;
}
