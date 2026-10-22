"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { fail, succeed, type ActionResult } from "@/lib/result";
import { parseForm, phoneSchema } from "@/lib/validation";


type R = ActionResult<{ redirectTo?: string }> | null;

const contactSchema = z.object({ displayName: z.string().trim().min(2).max(60), phone: phoneSchema });

export async function updateContactAction(_prev: R, formData: FormData): Promise<R> {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in first.");
  const parsed = parseForm(contactSchema, formData);
  if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
  await db.update(users).set({ displayName: parsed.data.displayName, phone: parsed.data.phone, updatedAt: new Date() }).where(eq(users.id, user.id));
  return succeed(undefined, "Saved.");
}
