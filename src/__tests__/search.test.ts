import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser, defaultLocation, firstSubjects, otherLocation, truncateAll } from "./setup";

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { searchTutors, parseSearchParams } = await import("@/server/search");

type Loc = { stateId: number; lgaId: number; cityId: number };

async function makeTutor(opts: { name: string; subjectId: number; loc: Loc; listed?: boolean; physical?: boolean; online?: boolean; price?: string; rank?: string; plan?: "premium" | "premium_plus"; publish?: boolean }) {
  const tutor = await createUser({ roles: ["tutor"], name: opts.name, location: opts.loc });
  await db
    .update(schema.tutorProfiles)
    .set({ isListed: opts.listed ?? true, offersPhysical: opts.physical ?? true, offersOnline: opts.online ?? true, rankScore: opts.rank ?? "0.5000", headline: `${opts.name} headline` })
    .where(eq(schema.tutorProfiles.userId, tutor.id));
  await db.insert(schema.tutorSubjects).values({ tutorId: tutor.id, subjectId: opts.subjectId, levels: ["senior_secondary"] });
  await db.insert(schema.tutorAvailability).values({ tutorId: tutor.id, weekday: 1, startMinute: 540, endMinute: 720, format: "hybrid" });
  if (opts.physical ?? true) await db.insert(schema.tutorServiceAreas).values({ tutorId: tutor.id, stateId: opts.loc.stateId, lgaId: opts.loc.lgaId, cityId: null });
  await db.insert(schema.packages).values({
    tutorId: tutor.id,
    title: `${opts.name} package`,
    description: "A package description that is comfortably longer than forty characters.",
    subjectId: opts.subjectId,
    level: "senior_secondary",
    format: "hybrid",
    priceNgn: opts.price ?? "5000.00",
    durationMinutes: 60,
    status: opts.publish === false ? "draft" : "published",
    publishedAt: opts.publish === false ? null : new Date(),
  });
  if (opts.plan) {
    await db.insert(schema.subscriptions).values({ tutorId: tutor.id, planCode: opts.plan, status: "active", source: "paid", startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 29 * 86_400_000) });
  }
  return tutor;
}

describe("tutor search", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("filters by subject, excludes unlisted tutors and tutors without a published package", async () => {
    const [maths, english] = await firstSubjects(2);
    const lagos = await defaultLocation();
    const a = await makeTutor({ name: "Ada Maths", subjectId: maths, loc: lagos });
    await makeTutor({ name: "Bola English", subjectId: english, loc: lagos });
    await makeTutor({ name: "Chidi Hidden", subjectId: maths, loc: lagos, listed: false });
    await makeTutor({ name: "Dayo Draft", subjectId: maths, loc: lagos, publish: false });

    const all = await searchTutors({});
    expect(all.total).toBe(2);
    expect(all.items.map((t) => t.name).sort()).toEqual(["Ada", "Bola"]);

    const onlyMaths = await searchTutors({ subject: maths });
    expect(onlyMaths.total).toBe(1);
    expect(onlyMaths.items[0].id).toBe(a.id);
    expect(onlyMaths.items[0].subjects.map((s) => s.id)).toContain(maths);
    expect(onlyMaths.items[0].minPrice).toBe("5000.00");
    expect(onlyMaths.items[0].identityVerified).toBe(true);
  });

  it("restricts physical results to tutors covering the LGA and boosts same-state tutors for online", async () => {
    const [maths] = await firstSubjects(1);
    const lagos = await defaultLocation();
    const kano = await otherLocation();
    const near = await makeTutor({ name: "Near Lagos", subjectId: maths, loc: lagos, rank: "0.4000" });
    const far = await makeTutor({ name: "Far Kano", subjectId: maths, loc: kano, rank: "0.4500" });

    const physical = await searchTutors({ format: "physical", state: lagos.stateId, lga: lagos.lgaId, city: lagos.cityId });
    expect(physical.total).toBe(1);
    expect(physical.items[0].id).toBe(near.id);

    const online = await searchTutors({ format: "online", state: lagos.stateId, lga: lagos.lgaId, city: lagos.cityId, sort: "recommended" });
    expect(online.total).toBe(2);
    // Far tutor has the higher organic rank, but the near tutor gains 0.15+0.10+0.05 location relevance.
    expect(online.items[0].id).toBe(near.id);
    expect(online.items[1].id).toBe(far.id);
    expect(online.items[0].score).toBeCloseTo(0.7, 5);
    expect(online.items[1].score).toBeCloseTo(0.45, 5);

    const physicalKano = await searchTutors({ format: "physical", state: kano.stateId, lga: kano.lgaId });
    expect(physicalKano.items.map((t) => t.id)).toEqual([far.id]);
  });

  it("labels paid-plan boosts as promoted and applies price/rating/verified filters", async () => {
    const [maths] = await firstSubjects(1);
    const lagos = await defaultLocation();
    const organic = await makeTutor({ name: "Organic Best", subjectId: maths, loc: lagos, rank: "0.6000", price: "3000.00" });
    const paid = await makeTutor({ name: "Paid Plus", subjectId: maths, loc: lagos, rank: "0.5500", plan: "premium_plus", price: "9000.00" });
    await db.update(schema.tutorProfiles).set({ ratingAvg: "4.50", ratingCount: 3, identityStatus: "pending" }).where(eq(schema.tutorProfiles.userId, paid.id));

    const rec = await searchTutors({ sort: "recommended" });
    expect(rec.items[0].id).toBe(paid.id); // 0.55 + 0.10 boost > 0.60
    expect(rec.items[0].promoted).toBe(true);
    expect(rec.items[0].planCode).toBe("premium_plus");
    expect(rec.items[0].boost).toBeCloseTo(0.1, 5);
    expect(rec.items[1].promoted).toBe(false);

    const cheap = await searchTutors({ maxPrice: "5000" });
    expect(cheap.items.map((t) => t.id)).toEqual([organic.id]);
    const byPrice = await searchTutors({ sort: "price_desc" });
    expect(byPrice.items.map((t) => t.id)).toEqual([paid.id, organic.id]);
    const rated = await searchTutors({ minRating: 4 });
    expect(rated.items.map((t) => t.id)).toEqual([paid.id]);
    const verified = await searchTutors({ verified: true });
    expect(verified.items.map((t) => t.id)).toEqual([organic.id]);
    const monday = await searchTutors({ available: 1 });
    expect(monday.total).toBe(2);
    const sunday = await searchTutors({ available: 0 });
    expect(sunday.total).toBe(0);
  });

  it("paginates with correct counts", async () => {
    const [maths] = await firstSubjects(1);
    const lagos = await defaultLocation();
    for (let i = 0; i < 7; i++) await makeTutor({ name: `Tutor${i} Page`, subjectId: maths, loc: lagos, rank: (0.9 - i * 0.05).toFixed(4) });
    const p1 = await searchTutors({ pageSize: 3, page: 1 });
    expect(p1.total).toBe(7);
    expect(p1.pageCount).toBe(3);
    expect(p1.items).toHaveLength(3);
    const p3 = await searchTutors({ pageSize: 3, page: 3 });
    expect(p3.items).toHaveLength(1);
    const ids = new Set([...p1.items, ...(await searchTutors({ pageSize: 3, page: 2 })).items, ...p3.items].map((t) => t.id));
    expect(ids.size).toBe(7);
    expect(p1.items[0].name).toBe("Tutor0");
  });

  it("parses URL search params leniently", () => {
    const p = parseSearchParams({ subject: "3", format: "physical", state: "12", lga: "x", minPrice: "2,000", sort: "bogus", page: "2", verified: "1", available: "7", minRating: "4" });
    expect(p).toMatchObject({ subject: 3, format: "physical", state: 12, lga: undefined, minPrice: "2000", sort: "recommended", page: 2, verified: true, available: undefined, minRating: 4 });
  });
});
