/**
 * Reference-data seed (idempotent). Safe to run on every deploy:
 *   npm run db:seed
 * Seeds Nigeria locations, subjects, exams, subscription plans. Never seeds demo
 * users or financial rows — see scripts/demo-data.ts for a clearly separate demo set.
 */
import { eq } from "drizzle-orm";
import { db, pool } from "./index";
import { cities, exams, lgas, states, subjects, subscriptionPlans } from "./schema";
import lgaData from "./seed-data/nigeria-lgas.json";
import { curatedCities, examsSeed, subjectsSeed } from "./seed-data/nigeria-cities";

export async function seedReferenceData() {
  // States + LGAs
  for (const s of lgaData as { name: string; code: string; lgas: string[] }[]) {
    const [state] = await db
      .insert(states)
      .values({ name: s.name, code: s.code })
      .onConflictDoUpdate({ target: states.code, set: { name: s.name } })
      .returning();
    for (const lgaName of s.lgas) {
      const [lga] = await db
        .insert(lgas)
        .values({ stateId: state.id, name: lgaName })
        .onConflictDoUpdate({ target: [lgas.stateId, lgas.name], set: { name: lgaName } })
        .returning();
      const names = new Set<string>([lgaName, ...(curatedCities[`${s.name}|${lgaName}`] ?? [])]);
      for (const cityName of names) {
        await db.insert(cities).values({ lgaId: lga.id, name: cityName }).onConflictDoNothing();
      }
    }
  }

  for (const sub of subjectsSeed) {
    await db
      .insert(subjects)
      .values(sub)
      .onConflictDoUpdate({ target: subjects.slug, set: { name: sub.name, category: sub.category } });
  }
  for (const ex of examsSeed) {
    await db.insert(exams).values(ex).onConflictDoUpdate({ target: exams.slug, set: { name: ex.name } });
  }

  const plans = [
    { code: "free", name: "Free", monthlyFeeNgn: "0.00", commissionPct: "30.00", maxPublishedPackages: 3, visibilityBoost: "0.00", profileBoostEligible: false, analyticsTools: false, sortOrder: 0 },
    { code: "premium", name: "Premium", monthlyFeeNgn: "3000.00", commissionPct: "20.00", maxPublishedPackages: null, visibilityBoost: "0.05", profileBoostEligible: true, analyticsTools: true, sortOrder: 1 },
    { code: "premium_plus", name: "Premium+", monthlyFeeNgn: "12000.00", commissionPct: "10.00", maxPublishedPackages: null, visibilityBoost: "0.10", profileBoostEligible: true, analyticsTools: true, sortOrder: 2 },
  ] as const;
  for (const p of plans) {
    const existing = await db.query.subscriptionPlans.findFirst({ where: eq(subscriptionPlans.code, p.code) });
    if (!existing) await db.insert(subscriptionPlans).values(p);
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seedReferenceData()
    .then(async () => {
      console.log("reference data seeded");
      await pool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
