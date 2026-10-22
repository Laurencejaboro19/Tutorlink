import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Use letters and at least one number");
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+234|0)[789][01]\d{8}$/, "Enter a valid Nigerian phone number")
  .transform((p) => (p.startsWith("0") ? "+234" + p.slice(1) : p));
export const uuidSchema = z.string().uuid();
export const moneySchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).replace(/[,₦\s]/g, ""))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Enter a valid amount");

export function parseForm<T extends z.ZodTypeAny>(schema: T, formData: FormData): { data: z.infer<T> } | { fieldErrors: Record<string, string[]>; error: string } {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("$")) continue;
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      (raw[key] as unknown[] | undefined) ? (raw[key] as unknown[]).push(v) : (raw[key] = [v]);
    } else raw[k] = v;
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { data: parsed.data };
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".") || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { fieldErrors, error: parsed.error.issues[0]?.message ?? "Check the form for errors" };
}
