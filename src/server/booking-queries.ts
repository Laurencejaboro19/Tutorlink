import "server-only";
import { and, asc, count, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bookings, cities, lgas, packages, reviews, subjects, tutorAvailability, tutorProfiles, users } from "@/db/schema";
import { DomainError } from "@/lib/result";
import { getSetting } from "@/lib/settings";
import { addMinutes, localParts, PLATFORM_TZ } from "@/lib/time";
import type { Tone } from "@/components/ui";

/* ---------------- labels ---------------- */

export const BOOKING_STATUS: Record<string, { label: string; tone: Tone }> = {
  hold: { label: "On hold", tone: "warning" },
  pending_payment: { label: "Awaiting payment", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "success" },
  completed: { label: "Completed", tone: "teal" },
  cancelled_by_student: { label: "Cancelled by student", tone: "neutral" },
  cancelled_by_tutor: { label: "Cancelled by tutor", tone: "danger" },
  no_show_student: { label: "Student no-show", tone: "danger" },
  no_show_tutor: { label: "Tutor no-show", tone: "danger" },
  disputed: { label: "Under review", tone: "warning" },
  refunded: { label: "Refunded", tone: "neutral" },
  expired: { label: "Expired (unpaid)", tone: "neutral" },
};

export function bookingStatus(status: string) {
  return BOOKING_STATUS[status] ?? { label: status.replaceAll("_", " "), tone: "neutral" as Tone };
}

export const ACTIVE_STATUSES = ["hold", "pending_payment", "confirmed"] as const;
const PAST_STATUSES = ["completed", "cancelled_by_student", "cancelled_by_tutor", "no_show_student", "no_show_tutor", "refunded", "expired"] as const;

/* ---------------- slot generation ---------------- */

export type DaySlots = { day: string; label: string; weekday: number; starts: { iso: string; label: string }[] };

/** Local calendar day (YYYY-MM-DD) + weekday in the platform timezone for a Date. */
function dayKey(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PLATFORM_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * All bookable start times for a package (30-minute steps) in the next `booking.max_days_ahead`
 * days, inside the tutor's weekly windows for the chosen format and clear of existing active bookings.
 */
export async function availableSlots(pkg: { tutorId: string; durationMinutes: number }, format: "physical" | "online"): Promise<DaySlots[]> {
  const [minLead, maxAhead] = await Promise.all([getSetting("booking.min_lead_hours"), getSetting("booking.max_days_ahead")]);
  const now = new Date();
  const earliest = now.getTime() + minLead * 3_600_000;
  const latest = now.getTime() + maxAhead * 86_400_000;
  const windows = await db.query.tutorAvailability.findMany({ where: eq(tutorAvailability.tutorId, pkg.tutorId) });
  const usable = windows.filter((w) => w.format === "hybrid" || w.format === format);
  if (!usable.length) return [];
  const taken = await db
    .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
    .from(bookings)
    .where(and(eq(bookings.tutorId, pkg.tutorId), inArray(bookings.status, [...ACTIVE_STATUSES]), gte(bookings.endsAt, now), lt(bookings.startsAt, new Date(latest))));

  // Lagos is UTC+1 without DST, so local midnight of day N = platformDayStart(day).
  const out: DaySlots[] = [];
  const dayFmt = new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: PLATFORM_TZ });
  const timeFmt = new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit", timeZone: PLATFORM_TZ });
  for (let i = 0; i <= maxAhead; i++) {
    const anyTime = new Date(now.getTime() + i * 86_400_000);
    const day = dayKey(anyTime);
    const midnight = new Date(`${day}T00:00:00+01:00`);
    const weekday = localParts(addMinutes(midnight, 60)).weekday;
    const starts: { iso: string; label: string }[] = [];
    const seen = new Set<number>();
    for (const w of usable.filter((w) => w.weekday === weekday)) {
      for (let m = Math.ceil(w.startMinute / 30) * 30; m + pkg.durationMinutes <= w.endMinute; m += 30) {
        if (seen.has(m)) continue;
        const s = addMinutes(midnight, m);
        const e = addMinutes(s, pkg.durationMinutes);
        if (s.getTime() < earliest || s.getTime() > latest) continue;
        if (taken.some((t) => t.startsAt.getTime() < e.getTime() && t.endsAt.getTime() > s.getTime())) continue;
        seen.add(m);
        starts.push({ iso: s.toISOString(), label: timeFmt.format(s) });
      }
    }
    if (starts.length) out.push({ day, label: dayFmt.format(midnight), weekday, starts: starts.sort((a, b) => a.iso.localeCompare(b.iso)) });
  }
  return out;
}

/* ---------------- listings ---------------- */

export type BookingTab = "upcoming" | "past" | "needs_action" | "all";
const PAGE = 10;

const listSelect = {
  id: bookings.id,
  status: bookings.status,
  format: bookings.format,
  startsAt: bookings.startsAt,
  endsAt: bookings.endsAt,
  priceNgn: bookings.priceNgn,
  amountDueNgn: bookings.amountDueNgn,
  paymentId: bookings.paymentId,
  tutorFirstResponseAt: bookings.tutorFirstResponseAt,
  packageTitle: packages.title,
  subject: subjects.name,
};

function tabCondition(tab: BookingTab, side: "student" | "tutor"): SQL | undefined {
  const now = new Date();
  switch (tab) {
    case "upcoming":
      return and(inArray(bookings.status, ["pending_payment", "confirmed"]), gte(bookings.endsAt, now));
    case "past":
      return or(inArray(bookings.status, [...PAST_STATUSES]), and(inArray(bookings.status, ["confirmed", "disputed"]), lt(bookings.endsAt, now)));
    case "needs_action":
      return side === "student"
        ? or(
            eq(bookings.status, "pending_payment"),
            and(eq(bookings.status, "confirmed"), lt(bookings.endsAt, now)),
            and(eq(bookings.status, "completed"), sql`not exists (select 1 from reviews r where r.booking_id = ${bookings.id})`),
          )
        : or(and(eq(bookings.status, "confirmed"), sql`${bookings.tutorFirstResponseAt} is null`), and(eq(bookings.status, "confirmed"), lt(bookings.endsAt, now)));
    default:
      return undefined;
  }
}

export async function listStudentBookings(studentId: string, tab: BookingTab, page: number) {
  const where = and(eq(bookings.studentId, studentId), tabCondition(tab, "student"));
  const order = tab === "upcoming" ? asc(bookings.startsAt) : desc(bookings.startsAt);
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({ ...listSelect, tutorName: users.displayName, tutorFull: users.fullName })
      .from(bookings)
      .innerJoin(packages, eq(packages.id, bookings.packageId))
      .innerJoin(subjects, eq(subjects.id, packages.subjectId))
      .innerJoin(users, eq(users.id, bookings.tutorId))
      .where(where)
      .orderBy(order)
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ n: count() }).from(bookings).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r, counterpart: r.tutorName ?? r.tutorFull.split(" ")[0] })), total: n, page, pageCount: Math.max(1, Math.ceil(n / PAGE)) };
}

export async function listTutorBookings(tutorId: string, tab: BookingTab, page: number) {
  const where = and(eq(bookings.tutorId, tutorId), tabCondition(tab, "tutor"));
  const order = tab === "upcoming" ? asc(bookings.startsAt) : desc(bookings.startsAt);
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({ ...listSelect, studentName: users.displayName, studentFull: users.fullName })
      .from(bookings)
      .innerJoin(packages, eq(packages.id, bookings.packageId))
      .innerJoin(subjects, eq(subjects.id, packages.subjectId))
      .innerJoin(users, eq(users.id, bookings.studentId))
      .where(where)
      .orderBy(order)
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ n: count() }).from(bookings).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r, counterpart: r.studentName ?? r.studentFull.split(" ")[0] })), total: n, page, pageCount: Math.max(1, Math.ceil(n / PAGE)) };
}

export async function countStudentBookings(studentId: string) {
  const [row] = await db
    .select({
      upcoming: sql<number>`count(*) filter (where ${bookings.status} in ('pending_payment','confirmed') and ${bookings.endsAt} >= now())`,
      completed: sql<number>`count(*) filter (where ${bookings.status} = 'completed')`,
      needsAction: sql<number>`count(*) filter (where ${bookings.status} = 'pending_payment' or (${bookings.status} = 'confirmed' and ${bookings.endsAt} < now()) or (${bookings.status} = 'completed' and not exists (select 1 from reviews r where r.booking_id = ${bookings.id})))`,
    })
    .from(bookings)
    .where(eq(bookings.studentId, studentId));
  return { upcoming: Number(row?.upcoming ?? 0), completed: Number(row?.completed ?? 0), needsAction: Number(row?.needsAction ?? 0) };
}

export async function countTutorBookings(tutorId: string) {
  const [row] = await db
    .select({
      upcoming: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.endsAt} >= now())`,
      completed: sql<number>`count(*) filter (where ${bookings.status} = 'completed')`,
      pendingAck: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.tutorFirstResponseAt} is null)`,
      endedUnmarked: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.endsAt} < now())`,
    })
    .from(bookings)
    .where(eq(bookings.tutorId, tutorId));
  return { upcoming: Number(row?.upcoming ?? 0), completed: Number(row?.completed ?? 0), pendingAck: Number(row?.pendingAck ?? 0), endedUnmarked: Number(row?.endedUnmarked ?? 0) };
}

export async function nextSession(userId: string, side: "student" | "tutor") {
  const who = side === "student" ? eq(bookings.studentId, userId) : eq(bookings.tutorId, userId);
  const other = side === "student" ? bookings.tutorId : bookings.studentId;
  const [row] = await db
    .select({ id: bookings.id, startsAt: bookings.startsAt, endsAt: bookings.endsAt, format: bookings.format, status: bookings.status, packageTitle: packages.title, subject: subjects.name, name: users.displayName, full: users.fullName })
    .from(bookings)
    .innerJoin(packages, eq(packages.id, bookings.packageId))
    .innerJoin(subjects, eq(subjects.id, packages.subjectId))
    .innerJoin(users, eq(users.id, other))
    .where(and(who, eq(bookings.status, "confirmed"), gte(bookings.endsAt, new Date())))
    .orderBy(asc(bookings.startsAt))
    .limit(1);
  return row ? { ...row, counterpart: row.name ?? row.full.split(" ")[0] } : null;
}

/* ---------------- detail ---------------- */

export async function getBookingDetail(bookingId: string, viewer: { id: string; side: "student" | "tutor" }) {
  const other = viewer.side === "student" ? bookings.tutorId : bookings.studentId;
  const [row] = await db
    .select({
      booking: bookings,
      pkg: { id: packages.id, title: packages.title, durationMinutes: packages.durationMinutes, sessionsCount: packages.sessionsCount, format: packages.format },
      subject: subjects.name,
      other: { id: users.id, displayName: users.displayName, fullName: users.fullName, phone: users.phone, avatarUrl: users.avatarUrl },
      lga: lgas.name,
      city: cities.name,
    })
    .from(bookings)
    .innerJoin(packages, eq(packages.id, bookings.packageId))
    .innerJoin(subjects, eq(subjects.id, packages.subjectId))
    .innerJoin(users, eq(users.id, other))
    .leftJoin(lgas, eq(lgas.id, bookings.lgaId))
    .leftJoin(cities, eq(cities.id, bookings.cityId))
    .where(and(eq(bookings.id, bookingId), viewer.side === "student" ? eq(bookings.studentId, viewer.id) : eq(bookings.tutorId, viewer.id)))
    .limit(1);
  if (!row) return null;
  const review = await db.query.reviews.findFirst({ where: eq(reviews.bookingId, bookingId) });
  const contactVisible = row.booking.status === "confirmed" || row.booking.status === "completed";
  return {
    ...row,
    review: review ?? null,
    other: { ...row.other, name: row.other.displayName ?? row.other.fullName.split(" ")[0], phone: contactVisible ? row.other.phone : null },
    locationText: row.booking.format === "physical" ? [row.city, row.lga ? `${row.lga} LGA` : null].filter(Boolean).join(", ") : null,
  };
}

/** Tutor sets the meeting link on their own confirmed online booking. */
export async function setMeetingLink(input: { bookingId: string; tutorId: string; meetingLink: string }) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, input.bookingId)).for("update");
    if (!b || b.tutorId !== input.tutorId) throw new DomainError("Booking not found.");
    if (b.status !== "confirmed") throw new DomainError("Only confirmed sessions can have a meeting link.");
    if (b.format !== "online") throw new DomainError("Meeting links are for online sessions.");
    await tx.update(bookings).set({ meetingLink: input.meetingLink, updatedAt: new Date() }).where(eq(bookings.id, b.id));
    return b;
  });
}

export async function tutorRatingSummary(tutorId: string) {
  const p = await db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, tutorId) });
  return p ? { ratingAvg: Number(p.ratingAvg), ratingCount: p.ratingCount, completedSessions: p.completedSessions } : null;
}
