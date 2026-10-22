import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser, defaultLocation, firstSubjects, futureAt, otherLocation, truncateAll } from "./setup";

/* The db module reads DATABASE_URL at import time; setup.ts loads .env.test first, so these
   dynamic imports (resolved once per file) see the test database. */
const dbMod = await import("@/db");
const schema = await import("@/db/schema");
const { DomainError } = await import("@/lib/result");
const { cancellationQuote, createBooking, markCompleted, quoteBooking, submitReview } = await import("@/server/bookings");
const { issueCredit } = await import("@/server/credits");
const { availableSlots } = await import("@/server/booking-queries");
const { db } = dbMod;

type PlanCode = "free" | "premium" | "premium_plus";

async function createTutor(opts: { plan?: PlanCode; windows?: { weekday: number; startMinute: number; endMinute: number }[]; areas?: boolean; price?: string } = {}) {
  const tutor = await createUser({ roles: ["tutor"], name: `Tutor ${Math.random().toString(36).slice(2, 6)}` });
  const [subjectId] = await firstSubjects(1);
  await db.insert(schema.tutorSubjects).values({ tutorId: tutor.id, subjectId, levels: ["senior_secondary"] });
  const windows = opts.windows ?? [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));
  await db.insert(schema.tutorAvailability).values(windows.map((w) => ({ tutorId: tutor.id, ...w, format: "hybrid" as const })));
  if (opts.areas !== false) {
    const loc = await defaultLocation();
    await db.insert(schema.tutorServiceAreas).values({ tutorId: tutor.id, stateId: loc.stateId, lgaId: loc.lgaId, cityId: null });
  }
  const [pkg] = await db
    .insert(schema.packages)
    .values({
      tutorId: tutor.id,
      title: "WAEC Mathematics crash course",
      description: "Four focused sessions on past questions and exam technique for senior secondary students.",
      subjectId,
      level: "senior_secondary",
      format: "hybrid",
      priceNgn: opts.price ?? "10000.00",
      durationMinutes: 60,
      sessionsCount: 1,
      status: "published",
      publishedAt: new Date(),
    })
    .returning();
  if (opts.plan && opts.plan !== "free") {
    await db.insert(schema.subscriptions).values({ tutorId: tutor.id, planCode: opts.plan, status: "active", source: "paid", startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 29 * 86_400_000) });
  }
  return { tutor, pkg, subjectId };
}

async function insertBooking(over: Partial<typeof schema.bookings.$inferInsert> & { studentId: string; tutorId: string; packageId: string }) {
  const startsAt = over.startsAt ?? futureAt(10, 2);
  const [b] = await db
    .insert(schema.bookings)
    .values({
      format: "online",
      status: "confirmed",
      priceNgn: "10000.00",
      creditAppliedNgn: "0.00",
      amountDueNgn: "10000.00",
      planCodeAtBooking: "free",
      commissionPct: "30.00",
      commissionNgn: "3000.00",
      tutorEarningNgn: "7000.00",
      confirmedAt: new Date(),
      ...over,
      startsAt,
      endsAt: over.endsAt ?? new Date(startsAt.getTime() + 3_600_000),
    })
    .returning();
  return b;
}

describe("bookings", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it.each<[PlanCode, string, string]>([
    ["free", "3000.00", "7000.00"],
    ["premium", "2000.00", "8000.00"],
    ["premium_plus", "1000.00", "9000.00"],
  ])("creates a pending_payment booking with a payment intent and %s-plan commission", async (plan, commission, earning) => {
    const { tutor, pkg } = await createTutor({ plan });
    const student = await createUser({ roles: ["student"] });
    const { booking, payment } = await createBooking({ studentId: student.id, packageId: pkg.id, startsAt: futureAt(10, 2), format: "online", useCredits: false });
    expect(booking.status).toBe("pending_payment");
    expect(booking.tutorId).toBe(tutor.id);
    expect(booking.priceNgn).toBe("10000.00");
    expect(booking.commissionNgn).toBe(commission);
    expect(booking.tutorEarningNgn).toBe(earning);
    expect(booking.planCodeAtBooking).toBe(plan);
    expect(booking.amountDueNgn).toBe("10000.00");
    expect(payment).not.toBeNull();
    expect(payment!.purpose).toBe("booking");
    expect(payment!.status).toBe("initiated");
    expect(payment!.amountNgn).toBe("10000.00");
    expect(payment!.bookingId).toBe(booking.id);
    const stored = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
    expect(stored?.paymentId).toBe(payment!.id);
    expect(stored?.holdExpiresAt).toBeInstanceOf(Date);
  });

  it("rejects an overlapping slot", async () => {
    const { tutor, pkg } = await createTutor();
    const other = await createUser({ roles: ["student"] });
    const student = await createUser({ roles: ["student"] });
    const startsAt = futureAt(10, 2);
    await insertBooking({ studentId: other.id, tutorId: tutor.id, packageId: pkg.id, startsAt, status: "confirmed" });
    // Starts 30 min into the existing session → overlaps.
    await expect(createBooking({ studentId: student.id, packageId: pkg.id, startsAt: new Date(startsAt.getTime() + 30 * 60_000), format: "online", useCredits: false })).rejects.toThrow(/slot was just taken/);
    // Back-to-back is fine.
    const next = await createBooking({ studentId: student.id, packageId: pkg.id, startsAt: new Date(startsAt.getTime() + 60 * 60_000), format: "online", useCredits: false });
    expect(next.booking.status).toBe("pending_payment");
  });

  it("rejects a time outside the tutor's availability", async () => {
    const start = futureAt(15, 2);
    const weekday = new Date(start.getTime() + 3_600_000).getUTCDay(); // Lagos weekday of that slot
    const { pkg } = await createTutor({ windows: [{ weekday, startMinute: 9 * 60, endMinute: 12 * 60 }] });
    const student = await createUser({ roles: ["student"] });
    await expect(createBooking({ studentId: student.id, packageId: pkg.id, startsAt: start, format: "online", useCredits: false })).rejects.toThrow(/outside the tutor's availability/);
    const ok = await createBooking({ studentId: student.id, packageId: pkg.id, startsAt: futureAt(10, 2), format: "online", useCredits: false });
    expect(ok.booking.status).toBe("pending_payment");
  });

  it("rejects a physical session outside the service area and accepts one inside", async () => {
    const { pkg } = await createTutor();
    const student = await createUser({ roles: ["student"] });
    const far = await otherLocation();
    await expect(createBooking({ studentId: student.id, packageId: pkg.id, startsAt: futureAt(10, 2), format: "physical", lgaId: far.lgaId, cityId: far.cityId, useCredits: false })).rejects.toThrow(/does not cover that area/);
    await expect(createBooking({ studentId: student.id, packageId: pkg.id, startsAt: futureAt(10, 2), format: "physical", lgaId: null, useCredits: false })).rejects.toThrow(DomainError);
    const near = await defaultLocation();
    const { booking } = await createBooking({ studentId: student.id, packageId: pkg.id, startsAt: futureAt(10, 2), format: "physical", lgaId: near.lgaId, cityId: near.cityId, useCredits: false });
    expect(booking.format).toBe("physical");
    expect(booking.lgaId).toBe(near.lgaId);
  });

  it("caps credits at 50% of the price", async () => {
    const { pkg } = await createTutor();
    const student = await createUser({ roles: ["student"] });
    await issueCredit({ userId: student.id, amountNgn: "8000.00", type: "promotional", source: "test", reason: "test credit", idempotencyKey: `test:${student.id}` });
    const q = await quoteBooking({ packageId: pkg.id, studentId: student.id, useCredits: true });
    expect(q.creditApplied).toBe("5000.00");
    expect(q.amountDue).toBe("5000.00");
    const { booking, payment } = await createBooking({ studentId: student.id, packageId: pkg.id, startsAt: futureAt(10, 2), format: "online", useCredits: true });
    expect(booking.creditAppliedNgn).toBe("5000.00");
    expect(booking.amountDueNgn).toBe("5000.00");
    expect(payment?.amountNgn).toBe("5000.00");
    // Commission is still computed on the full price.
    expect(booking.commissionNgn).toBe("3000.00");
  });

  it("quotes 100% refund ≥24h before and 50% for late cancellation", async () => {
    const { tutor, pkg } = await createTutor();
    const student = await createUser({ roles: ["student"] });
    const early = await insertBooking({ studentId: student.id, tutorId: tutor.id, packageId: pkg.id, startsAt: new Date(Date.now() + 48 * 3_600_000) });
    const late = await insertBooking({ studentId: student.id, tutorId: tutor.id, packageId: pkg.id, startsAt: new Date(Date.now() + 5 * 3_600_000) });
    const q1 = await cancellationQuote(early, "student");
    expect(q1.refundPct).toBe(100);
    expect(q1.refundNgn).toBe("10000.00");
    const q2 = await cancellationQuote(late, "student");
    expect(q2.refundPct).toBe(50);
    expect(q2.refundNgn).toBe("5000.00");
    // Tutor cancellations always refund in full.
    expect((await cancellationQuote(late, "tutor")).refundPct).toBe(100);
  });

  it("refuses to mark a session completed before it ends", async () => {
    const { tutor, pkg } = await createTutor();
    const student = await createUser({ roles: ["student"] });
    const b = await insertBooking({ studentId: student.id, tutorId: tutor.id, packageId: pkg.id, startsAt: new Date(Date.now() + 3_600_000) });
    await expect(markCompleted({ bookingId: b.id, actorId: student.id, role: "student" })).rejects.toThrow(/not ended yet/);
    const past = await insertBooking({ studentId: student.id, tutorId: tutor.id, packageId: pkg.id, startsAt: new Date(Date.now() - 3 * 3_600_000), endsAt: new Date(Date.now() - 2 * 3_600_000) });
    const done = await markCompleted({ bookingId: past.id, actorId: student.id, role: "student" });
    expect(done.status).toBe("completed");
    // A stranger cannot complete someone else's booking.
    const stranger = await createUser({ roles: ["student"] });
    const another = await insertBooking({ studentId: student.id, tutorId: tutor.id, packageId: pkg.id, startsAt: new Date(Date.now() - 3 * 3_600_000), endsAt: new Date(Date.now() - 2 * 3_600_000) });
    await expect(markCompleted({ bookingId: another.id, actorId: stranger.id, role: "student" })).rejects.toThrow(/Not your booking/);
  });

  it("allows one review, only for completed sessions", async () => {
    const { tutor, pkg } = await createTutor();
    const student = await createUser({ roles: ["student"] });
    const confirmed = await insertBooking({ studentId: student.id, tutorId: tutor.id, packageId: pkg.id });
    await expect(submitReview({ bookingId: confirmed.id, studentId: student.id, rating: 5, comment: null })).rejects.toThrow(/once it is completed/);
    const completed = await insertBooking({ studentId: student.id, tutorId: tutor.id, packageId: pkg.id, status: "completed", completedAt: new Date(), startsAt: new Date(Date.now() - 3 * 3_600_000), endsAt: new Date(Date.now() - 2 * 3_600_000) });
    const review = await submitReview({ bookingId: completed.id, studentId: student.id, rating: 4, comment: "Great session" });
    expect(review.rating).toBe(4);
    await expect(submitReview({ bookingId: completed.id, studentId: student.id, rating: 5, comment: null })).rejects.toThrow(/already reviewed/);
    const profile = await db.query.tutorProfiles.findFirst({ where: eq(schema.tutorProfiles.userId, tutor.id) });
    expect(profile?.ratingCount).toBe(1);
    expect(profile?.ratingAvg).toBe("4.00");
  });

  it("generates 30-minute slots inside availability and excludes booked times", async () => {
    const start = futureAt(10, 2);
    const weekday = new Date(start.getTime() + 3_600_000).getUTCDay();
    const { tutor, pkg } = await createTutor({ windows: [{ weekday, startMinute: 9 * 60, endMinute: 12 * 60 }] });
    const student = await createUser({ roles: ["student"] });
    await insertBooking({ studentId: student.id, tutorId: tutor.id, packageId: pkg.id, startsAt: start });
    const days = await availableSlots(pkg, "online");
    expect(days.length).toBeGreaterThan(0);
    const day = days.find((d) => d.starts.some((s) => new Date(s.iso).getTime() === start.getTime() - 3_600_000));
    expect(day).toBeDefined();
    const labels = day!.starts.map((s) => new Date(s.iso).toISOString());
    // 9:00 fits before the 10:00–11:00 booking and 11:00 fits after; 9:30, 10:00 and 10:30 overlap it; 11:30 would run past 12:00.
    expect(labels).toContain(new Date(start.getTime() - 3_600_000).toISOString());
    expect(labels).toContain(new Date(start.getTime() + 3_600_000).toISOString());
    expect(labels).not.toContain(new Date(start.getTime() - 30 * 60_000).toISOString());
    expect(labels).not.toContain(start.toISOString());
    expect(labels).not.toContain(new Date(start.getTime() + 30 * 60_000).toISOString());
    expect(labels).not.toContain(new Date(start.getTime() + 90 * 60_000).toISOString());
  });
});
