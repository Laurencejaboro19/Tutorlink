import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cities, lgas } from "@/db/schema";

export const locationSchema = z.object({
  stateId: z.coerce.number().int().positive("Select your state"),
  lgaId: z.coerce.number().int().positive("Select your LGA"),
  cityId: z.coerce.number().int().positive("Select your city or town"),
});

/** Validates that city ∈ lga ∈ state and returns the resolved ids. */
export async function resolveLocation(input: { stateId: number; lgaId: number; cityId: number }) {
  const row = await db
    .select({ cityId: cities.id, lgaId: lgas.id, stateId: lgas.stateId })
    .from(cities)
    .innerJoin(lgas, eq(cities.lgaId, lgas.id))
    .where(and(eq(cities.id, input.cityId), eq(lgas.id, input.lgaId), eq(lgas.stateId, input.stateId)))
    .limit(1);
  return row[0] ?? null;
}

