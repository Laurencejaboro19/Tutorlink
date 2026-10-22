"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cities, lgas } from "@/db/schema";
import { assertRole } from "@/lib/auth";
import { fail, succeed, toActionError, type ActionResult } from "@/lib/result";
import { parseForm, uuidSchema } from "@/lib/validation";
import { cancelBooking, createBooking, markCompleted, recordTutorResponse, reportNoShow, submitReview } from "@/server/bookings";
import { setMeetingLink } from "@/server/booking-queries";

type R = ActionResult<{ redirectTo?: string }> | null;

const optionalInt = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined || v === "" ? null : Number(v)))
  .refine((v) => v === null || (Number.isInteger(v) && v > 0), "Invalid selection");

const createSchema = z.object({
  packageId: uuidSchema,
  format: z.enum(["physical", "online"], { message: "Choose a session format" }),
  startsAt: z
    .string()
    .min(1, "Pick a date and time")
    .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a date and time"),
  stateId: optionalInt,
  lgaId: optionalInt,
  cityId: optionalInt,
  addressNote: z.string().trim().max(300).optional().or(z.literal("")),
  studentNote: z.string().trim().max(1000).optional().or(z.literal("")),
  useCredits: z.string().optional(),
});

export async function createBookingAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("student");
    const parsed = parseForm(createSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    const d = parsed.data;
    let lgaId: number | null = null;
    let cityId: number | null = null;
    if (d.format === "physical") {
      if (!d.lgaId) return fail("Choose the LGA where the session will take place.", { lgaId: ["Choose an LGA"] });
      const lga = await db.query.lgas.findFirst({ where: and(eq(lgas.id, d.lgaId), ...(d.stateId ? [eq(lgas.stateId, d.stateId)] : [])) });
      if (!lga) return fail("That location could not be matched.", { lgaId: ["Pick the LGA again"] });
      lgaId = lga.id;
      if (d.cityId) {
        const city = await db.query.cities.findFirst({ where: and(eq(cities.id, d.cityId), eq(cities.lgaId, lga.id)) });
        if (!city) return fail("That city is not in the selected LGA.", { cityId: ["Pick the city again"] });
        cityId = city.id;
      }
    }
    const { booking, payment } = await createBooking({
      studentId: user.id,
      packageId: d.packageId,
      startsAt: new Date(d.startsAt),
      format: d.format,
      lgaId,
      cityId,
      addressNote: d.addressNote || null,
      studentNote: d.studentNote || null,
      useCredits: !!d.useCredits,
    });
    return succeed({ redirectTo: payment ? `/pay/${payment.id}` : `/dashboard/bookings/${booking.id}` });
  } catch (e) {
    return toActionError(e);
  }
}

const cancelSchema = z.object({ bookingId: uuidSchema, reason: z.string().trim().min(5, "Tell us why (at least 5 characters)").max(500) });

export async function cancelBookingAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const role = formData.get("role") === "tutor" ? "tutor" : "student";
    const user = await assertRole(role);
    const parsed = parseForm(cancelSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    const res = await cancelBooking({ bookingId: parsed.data.bookingId, actorId: user.id, role, reason: parsed.data.reason });
    return succeed(undefined, `Session cancelled. ${res.quote.refundPct > 0 ? `Refund: ${res.quote.refundPct}% of the amount paid.` : "No refund applies."}`);
  } catch (e) {
    return toActionError(e);
  }
}

const noShowSchema = z.object({ bookingId: uuidSchema, details: z.string().trim().min(10, "Describe what happened (at least 10 characters)").max(1000) });

export async function reportNoShowAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const role = formData.get("role") === "tutor" ? "tutor" : "student";
    const user = await assertRole(role);
    const parsed = parseForm(noShowSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await reportNoShow({ bookingId: parsed.data.bookingId, actorId: user.id, role, details: parsed.data.details });
    return succeed(undefined, "Report received. The session is now under review; our team will decide on refunds.");
  } catch (e) {
    return toActionError(e);
  }
}

const idSchema = z.object({ bookingId: uuidSchema });

export async function markCompletedAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const role = formData.get("role") === "tutor" ? "tutor" : "student";
    const user = await assertRole(role);
    const parsed = parseForm(idSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await markCompleted({ bookingId: parsed.data.bookingId, actorId: user.id, role });
    return succeed(undefined, "Session marked as completed.");
  } catch (e) {
    return toActionError(e);
  }
}

const reviewSchema = z.object({
  bookingId: uuidSchema,
  rating: z.coerce.number().int().min(1, "Choose a star rating").max(5),
  comment: z.string().trim().max(1000).optional().or(z.literal("")),
});

export async function submitReviewAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("student");
    const parsed = parseForm(reviewSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await submitReview({ bookingId: parsed.data.bookingId, studentId: user.id, rating: parsed.data.rating, comment: parsed.data.comment || null });
    return succeed(undefined, "Thanks — your review is published.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function acknowledgeBookingAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(idSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await recordTutorResponse(parsed.data.bookingId, user.id);
    return succeed(undefined, "Acknowledged. Fast responses improve your ranking.");
  } catch (e) {
    return toActionError(e);
  }
}

const linkSchema = z.object({ bookingId: uuidSchema, meetingLink: z.string().trim().url("Enter a full link, e.g. https://meet.google.com/abc-defg-hij").max(500) });

export async function setMeetingLinkAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertRole("tutor");
    const parsed = parseForm(linkSchema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    await setMeetingLink({ bookingId: parsed.data.bookingId, tutorId: user.id, meetingLink: parsed.data.meetingLink });
    return succeed(undefined, "Meeting link saved. The student can see it on their booking.");
  } catch (e) {
    return toActionError(e);
  }
}
