"use server";

import { z } from "zod";
import { assertUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { fail, succeed, toActionError, type ActionResult } from "@/lib/result";
import { parseForm, uuidSchema } from "@/lib/validation";
import { createReport, REPORT_REASONS, REPORT_TARGETS } from "@/server/admin";

type R = ActionResult<{ redirectTo?: string }> | null;

const schema = z.object({
  type: z.enum(REPORT_TARGETS, { error: "Choose what you are reporting" }),
  id: uuidSchema,
  reason: z.enum(REPORT_REASONS, { error: "Choose a reason" }),
  details: z.string().trim().max(2000, "Keep details under 2000 characters").optional().default(""),
});

/** Signed-in users report a user, booking, challenge or review. Rate limited to 5 per hour. */
export async function createReportAction(_prev: R, formData: FormData): Promise<R> {
  try {
    const user = await assertUser();
    const parsed = parseForm(schema, formData);
    if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
    const d = parsed.data;
    if (d.reason === "other" && d.details.length < 10) return fail("Tell us a little more so we can look into it.", { details: ["Add at least 10 characters"] });
    if (!(await rateLimit(`report:${user.id}`, 5, 3600))) return fail("You have sent several reports recently. Please wait an hour before sending another.");
    const row = await createReport(user.id, { targetType: d.type, targetId: d.id, reason: d.reason, details: d.details });
    return succeed({ redirectTo: `/report?sent=${row.id}` }, "Report sent.");
  } catch (e) {
    return toActionError(e);
  }
}
