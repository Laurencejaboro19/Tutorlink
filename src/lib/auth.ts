import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { oneTimeTokens, sessions, users } from "@/db/schema";

export const SESSION_COOKIE = "tl_session";
const SESSION_DAYS = 30;

export type CurrentUser = typeof users.$inferSelect;

/* ---------- passwords ---------- */

export async function hashPassword(password: string) {
  return argonHash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hashed: string, password: string) {
  try {
    return await argonVerify(hashed, password);
  } catch {
    return false;
  }
}

/* ---------- tokens ---------- */

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/* ---------- sessions ---------- */

export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const h = await headers();
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    expiresAt,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
    ip: clientIp(h),
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

export async function destroyAllSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export function clientIp(h: Headers) {
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim().slice(0, 64) || null;
}

/** Resolve the signed-in user for this request (memoised per request). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date()), isNull(users.deletedAt)))
    .limit(1);
  const user = row[0]?.user ?? null;
  if (!user || user.status === "suspended") return null;
  return user;
});

/* ---------- guards (server-side authorisation) ---------- */

export class AuthError extends Error {
  constructor(
    message: string,
    public status: 401 | 403 = 403,
  ) {
    super(message);
  }
}

export async function requireUser(opts: { allowIncompleteOnboarding?: boolean } = {}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!opts.allowIncompleteOnboarding && user.onboardingStep !== "complete") redirect("/onboarding");
  return user;
}

export async function requireStudent() {
  const user = await requireUser();
  if (!user.isStudent) redirect("/account/roles?need=student");
  return user;
}

export async function requireTutor() {
  const user = await requireUser();
  if (!user.isTutor) redirect("/account/roles?need=tutor");
  return user;
}

export type AdminRole = "super" | "moderator" | "finance";

export async function requireAdmin(allowed: AdminRole[] = ["super", "moderator", "finance"]) {
  const user = await requireUser();
  if (!user.adminRole || !allowed.includes(user.adminRole)) redirect("/");
  return user as CurrentUser & { adminRole: AdminRole };
}

/** Variant for server actions / route handlers: throws instead of redirecting. */
export async function assertUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Please sign in.", 401);
  return user;
}

export async function assertRole(role: "student" | "tutor") {
  const user = await assertUser();
  if (role === "student" && !user.isStudent) throw new AuthError("Student access required.");
  if (role === "tutor" && !user.isTutor) throw new AuthError("Tutor access required.");
  if (user.onboardingStep !== "complete") throw new AuthError("Finish onboarding first.");
  return user;
}

export async function assertAdmin(allowed: AdminRole[] = ["super", "moderator", "finance"]) {
  const user = await assertUser();
  if (!user.adminRole || !allowed.includes(user.adminRole)) throw new AuthError("Admin access required.");
  return user as CurrentUser & { adminRole: AdminRole };
}

/* ---------- one-time tokens (email verification / password reset) ---------- */

export async function issueOneTimeToken(userId: string, purpose: "verify_email" | "reset_password", ttlMinutes = 60) {
  const token = randomToken(24);
  await db.insert(oneTimeTokens).values({
    userId,
    purpose,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
  });
  return token;
}

export async function consumeOneTimeToken(token: string, purpose: "verify_email" | "reset_password") {
  return db.transaction(async (tx) => {
    const row = await tx.query.oneTimeTokens.findFirst({
      where: and(eq(oneTimeTokens.tokenHash, sha256(token)), eq(oneTimeTokens.purpose, purpose), isNull(oneTimeTokens.usedAt), gt(oneTimeTokens.expiresAt, new Date())),
    });
    if (!row) return null;
    await tx.update(oneTimeTokens).set({ usedAt: new Date() }).where(eq(oneTimeTokens.id, row.id));
    return row.userId;
  });
}
