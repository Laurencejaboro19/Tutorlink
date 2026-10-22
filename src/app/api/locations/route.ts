import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { cities, lgas, states } from "@/db/schema";

export const revalidate = 3600;

/** Public reference data: /api/locations (states), ?state=ID (LGAs), ?lga=ID (cities). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const stateId = Number(url.searchParams.get("state"));
  const lgaId = Number(url.searchParams.get("lga"));
  const headers = { "Cache-Control": "public, max-age=3600, s-maxage=86400" };
  if (lgaId) {
    const rows = await db.select({ id: cities.id, name: cities.name }).from(cities).where(eq(cities.lgaId, lgaId)).orderBy(asc(cities.name));
    return NextResponse.json(rows, { headers });
  }
  if (stateId) {
    const rows = await db.select({ id: lgas.id, name: lgas.name }).from(lgas).where(eq(lgas.stateId, stateId)).orderBy(asc(lgas.name));
    return NextResponse.json(rows, { headers });
  }
  const rows = await db.select({ id: states.id, name: states.name }).from(states).orderBy(asc(states.name));
  return NextResponse.json(rows, { headers });
}
