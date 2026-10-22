import "server-only";
import { asc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { cities, exams, lgas, states, subjects } from "@/db/schema";

export const listStates = cache(async () => db.select({ id: states.id, name: states.name }).from(states).orderBy(asc(states.name)));
export const listSubjects = cache(async () => db.select().from(subjects).where(eq(subjects.active, true)).orderBy(asc(subjects.category), asc(subjects.name)));
export const listExams = cache(async () => db.select().from(exams).where(eq(exams.active, true)).orderBy(asc(exams.id)));

export const LEVELS = [
  { value: "primary", label: "Primary" },
  { value: "junior_secondary", label: "Junior secondary (JSS)" },
  { value: "senior_secondary", label: "Senior secondary (SSS)" },
  { value: "tertiary", label: "University / Polytechnic" },
  { value: "adult", label: "Adult & professional" },
] as const;

export function levelLabel(v: string) {
  return LEVELS.find((l) => l.value === v)?.label ?? v;
}

export async function locationLabel(ids: { stateId?: number | null; lgaId?: number | null; cityId?: number | null }) {
  const parts: string[] = [];
  if (ids.cityId) {
    const c = await db.query.cities.findFirst({ where: eq(cities.id, ids.cityId) });
    if (c) parts.push(c.name);
  }
  if (ids.lgaId) {
    const l = await db.query.lgas.findFirst({ where: eq(lgas.id, ids.lgaId) });
    if (l && !parts.includes(l.name)) parts.push(l.name);
  }
  if (ids.stateId) {
    const s = await db.query.states.findFirst({ where: eq(states.id, ids.stateId) });
    if (s) parts.push(s.name);
  }
  return parts.join(", ");
}
