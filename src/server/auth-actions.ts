"use server";

import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { referralCodes, referrals, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { clientIp, consumeOneTimeToken, createSession, destroyAllSessions, destroySession, getCurrentUser, hashPassword, issueOneTimeToken, verifyPassword } from "@/lib/auth";
import { appUrl, sendEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";
import { fail, succeed, toActionError, type ActionResult } from "@/lib/result";
import { emailSchema, parseForm, passwordSchema } from "@/lib/validation";
import { onReferredUserVerified } from "@/server/referrals";

type R = ActionResult<{ redirectTo?: string; debugLink?: string }> | null;

const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(120),
  email: emailSchema,
  password: passwordSchema,
  ref: z.string().trim().max(16).optional().or(z.literal("")),
  accept: z.literal("on", { message: "You must accept the terms and privacy notice" }),
});

export async function registerAction(_prev: R, formData: FormData): Promise<R> {
  const parsed = parseForm(registerSchema, formData);
  if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
  const { fullName, email, password, ref } = parsed.data;
  const h = await headers();
  const ip = clientIp(h);
  if (!(await rateLimit(`register:${ip ?? "unknown"}`, 10, 3600))) return fail("Too many sign-ups from this network. Try again later.");

  try {
    const existing = await db.query.users.findFirst({ where: sql`lower(${users.email}) = ${email}` });
    if (existing) return fail("An account with this email already exists. Try signing in.", { email: ["Already registered"] });

    const passwordHash = await hashPassword(password);
    const bootstrapAdmin = process.env.ADMIN_BOOTSTRAP_EMAIL?.toLowerCase() === email;

    const referrer = ref ? await db.query.referralCodes.findFirst({ where: eq(referralCodes.code, ref.toUpperCase()) }) : null;

    const user = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          fullName,
          email,
          passwordHash,
          adminRole: bootstrapAdmin ? "super" : null,
          referredByUserId: referrer?.userId ?? null,
        })
        .returning();
      if (referrer && referrer.userId !== u.id) {
        await tx.insert(referrals).values({
          referrerId: referrer.userId,
          referredUserId: u.id,
          kind: "student", // reclassified at role selection
          signupIp: ip,
        });
      }
      await audit({ actorId: u.id, action: "auth.register", targetType: "user", targetId: u.id, ip }, tx);
      return u;
    });

    const token = await issueOneTimeToken(user.id, "verify_email", 60 * 24);
    const link = appUrl(`/verify-email?token=${token}`);
    const sent = await sendEmail({
      to: email,
      subject: "Verify your TutorLink email",
      text: `Welcome to TutorLink, ${fullName}. Verify your email: ${link}`,
      html: `<p>Welcome to TutorLink, ${fullName}.</p><p><a href="${link}">Verify your email address</a> (link valid for 24 hours).</p>`,
      debugLink: link,
    });
    await createSession(user.id);
    return succeed({ redirectTo: "/onboarding", debugLink: sent.debugLink });
  } catch (e) {
    return toActionError(e);
  }
}

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password"), next: z.string().optional() });

export async function loginAction(_prev: R, formData: FormData): Promise<R> {
  const parsed = parseForm(loginSchema, formData);
  if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
  const { email, password, next } = parsed.data;
  const h = await headers();
  const ip = clientIp(h);
  if (!(await rateLimit(`login:${ip ?? "unknown"}:${email}`, 8, 900))) return fail("Too many attempts. Please wait 15 minutes and try again.");

  const user = await db.query.users.findFirst({ where: sql`lower(${users.email}) = ${email}` });
  const ok = user ? await verifyPassword(user.passwordHash, password) : await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", password);
  if (!user || !ok || user.deletedAt) return fail("Incorrect email or password.");
  if (user.status === "suspended") return fail("This account is suspended. Contact support@tutorlink.ng.");

  await createSession(user.id);
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
  await audit({ actorId: user.id, action: "auth.login", targetType: "user", targetId: user.id, ip });
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  return succeed({ redirectTo: user.onboardingStep !== "complete" ? "/onboarding" : (safeNext ?? "/dashboard") });
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

export async function resendVerificationAction(): Promise<R> {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in first.");
  if (user.emailVerifiedAt) return succeed({ redirectTo: "/onboarding" });
  if (!(await rateLimit(`resend:${user.id}`, 3, 900))) return fail("Please wait before requesting another email.");
  const token = await issueOneTimeToken(user.id, "verify_email", 60 * 24);
  const link = appUrl(`/verify-email?token=${token}`);
  const sent = await sendEmail({
    to: user.email,
    subject: "Verify your TutorLink email",
    text: `Verify your email: ${link}`,
    html: `<p><a href="${link}">Verify your email address</a> (valid 24 hours).</p>`,
    debugLink: link,
  });
  return succeed({ debugLink: sent.debugLink }, sent.delivered ? "Verification email sent." : "Email delivery is not configured on this deployment yet.");
}

export async function verifyEmailToken(token: string): Promise<{ ok: boolean; message: string }> {
  const userId = await consumeOneTimeToken(token, "verify_email");
  if (!userId) return { ok: false, message: "This verification link is invalid or has expired." };
  await db.transaction(async (tx) => {
    const u = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (!u) return;
    await tx
      .update(users)
      .set({
        emailVerifiedAt: u.emailVerifiedAt ?? new Date(),
        onboardingStep: u.onboardingStep === "verify_email" ? "location" : u.onboardingStep,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await audit({ actorId: userId, action: "auth.email_verified", targetType: "user", targetId: userId }, tx);
  });
  await onReferredUserVerified(userId);
  return { ok: true, message: "Email verified." };
}

const forgotSchema = z.object({ email: emailSchema });

export async function forgotPasswordAction(_prev: R, formData: FormData): Promise<R> {
  const parsed = parseForm(forgotSchema, formData);
  if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
  const h = await headers();
  if (!(await rateLimit(`forgot:${clientIp(h) ?? "unknown"}`, 5, 900))) return fail("Too many requests. Try again later.");
  const user = await db.query.users.findFirst({ where: sql`lower(${users.email}) = ${parsed.data.email}` });
  let debugLink: string | undefined;
  if (user) {
    const token = await issueOneTimeToken(user.id, "reset_password", 30);
    const link = appUrl(`/reset-password?token=${token}`);
    const sent = await sendEmail({
      to: user.email,
      subject: "Reset your TutorLink password",
      text: `Reset your password: ${link} (valid 30 minutes). If you did not request this, ignore this email.`,
      html: `<p><a href="${link}">Reset your password</a> (valid 30 minutes).</p><p>If you did not request this, ignore this email.</p>`,
      debugLink: link,
    });
    debugLink = sent.debugLink;
  }
  // Same response whether or not the account exists.
  return succeed({ debugLink }, "If that email is registered, a reset link has been sent.");
}

const resetSchema = z.object({ token: z.string().min(10), password: passwordSchema });

export async function resetPasswordAction(_prev: R, formData: FormData): Promise<R> {
  const parsed = parseForm(resetSchema, formData);
  if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
  const userId = await consumeOneTimeToken(parsed.data.token, "reset_password");
  if (!userId) return fail("This reset link is invalid or has expired.");
  const passwordHash = await hashPassword(parsed.data.password);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  await destroyAllSessions(userId);
  await audit({ actorId: userId, action: "auth.password_reset", targetType: "user", targetId: userId });
  return succeed({ redirectTo: "/login?reset=1" }, "Password updated. Sign in with your new password.");
}

const changePasswordSchema = z.object({ current: z.string().min(1), password: passwordSchema });

export async function changePasswordAction(_prev: R, formData: FormData): Promise<R> {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in first.");
  const parsed = parseForm(changePasswordSchema, formData);
  if ("fieldErrors" in parsed) return fail(parsed.error, parsed.fieldErrors);
  if (!(await verifyPassword(user.passwordHash, parsed.data.current))) return fail("Current password is incorrect.", { current: ["Incorrect"] });
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password), updatedAt: new Date() }).where(eq(users.id, user.id));
  await audit({ actorId: user.id, action: "auth.password_changed", targetType: "user", targetId: user.id });
  return succeed(undefined, "Password changed.");
}

export async function deleteAccountAction(_prev: R, formData: FormData): Promise<R> {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in first.");
  const password = String(formData.get("password") ?? "");
  if (!(await verifyPassword(user.passwordHash, password))) return fail("Password is incorrect.");
  // Soft delete: financial history must be preserved; personal fields are minimised.
  await db
    .update(users)
    .set({
      deletedAt: new Date(),
      status: "deleted",
      email: `deleted+${user.id}@tutorlink.invalid`,
      fullName: "Deleted user",
      displayName: null,
      phone: null,
      avatarUrl: null,
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, user.id)));
  await audit({ actorId: user.id, action: "account.deleted", targetType: "user", targetId: user.id });
  await destroySession();
  return succeed({ redirectTo: "/?deleted=1" });
}
