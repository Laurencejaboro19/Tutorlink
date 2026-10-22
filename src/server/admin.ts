import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, notExists, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  attempts,
  auditLogs,
  bookings,
  challenges,
  creditEntries,
  leaderboardCycles,
  ledgerEntries,
  packages,
  payments,
  payouts,
  platformSettings,
  questions,
  referralEvents,
  referrals,
  refunds,
  reports,
  reviews,
  sessions,
  studentRewards,
  subscriptionPlans,
  subscriptions,
  tutorProfiles,
  tutorQualifications,
  tutorRewards,
  users,
  webhookEvents,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { AuthError, type AdminRole } from "@/lib/auth";
import { fromKobo, ngn, toKobo, type Ngn } from "@/lib/money";
import { notify } from "@/lib/notify";
import { DomainError } from "@/lib/result";
import { settingDefaults, setSetting, type SettingKey } from "@/lib/settings";
import { cancelBooking, resolveDispute } from "./bookings";
import { creditBalance, issueCredit, reverseCredit } from "./credits";
import { platformTotals } from "./ledger";
import { handleWebhookEvent, reconcileByReference } from "./payments";
import { recomputeTutorRank } from "./ranking";
import { approveRefund, executeRefund, rejectRefund } from "./refunds";
import { grantPromotionalMonth } from "./subscriptions";

/**
 * Administration services. Every mutating function takes an `actor` and enforces the
 * permission model here (not only in the action layer) so the rules are testable
 * without a request context:
 *   super     everything, including settings, user role changes and admin grants
 *   moderator users (suspend), tutor verification, challenge review, reports, bookings oversight
 *   finance   payments reconciliation, refunds, payouts, rewards, subscriptions, credit adjustments
 */
export type AdminActor = { id: string; adminRole?: AdminRole | null };

export const PAGE_SIZE = 25;
const ALL: AdminRole[] = ["super", "moderator", "finance"];
const MOD: AdminRole[] = ["super", "moderator"];
const FIN: AdminRole[] = ["super", "finance"];
const SUPER: AdminRole[] = ["super"];

export function requireRole(actor: AdminActor, allowed: AdminRole[]): AdminRole {
  if (!actor?.adminRole || !allowed.includes(actor.adminRole)) throw new AuthError("Admin access required.");
  return actor.adminRole;
}

function page(p: number | undefined) {
  const current = Math.max(1, Math.floor(p ?? 1));
  return { current, limit: PAGE_SIZE, offset: (current - 1) * PAGE_SIZE };
}

function paged<T>(rows: T[], total: number, current: number) {
  return { rows, total, page: current, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

function dayRange(from?: string, to?: string) {
  const f = from ? new Date(from) : null;
  const t = to ? new Date(to) : null;
  return { from: f && !Number.isNaN(f.getTime()) ? f : null, to: t && !Number.isNaN(t.getTime()) ? new Date(t.getTime() + 86_400_000) : null };
}

async function lookupUserIds(q: string) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(or(ilike(users.email, `%${q}%`), ilike(users.fullName, `%${q}%`)))
    .limit(200);
  return rows.map((r) => r.id);
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export async function overviewStats() {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [[u], [t], [b], [c], [r], [rf], [po], [rw], bookingsByStatus] = await Promise.all([
    db
      .select({
        total: count(),
        students: sql<number>`count(*) filter (where ${users.isStudent})`,
        tutors: sql<number>`count(*) filter (where ${users.isTutor})`,
        admins: sql<number>`count(*) filter (where ${users.adminRole} is not null)`,
        suspended: sql<number>`count(*) filter (where ${users.status} = 'suspended')`,
      })
      .from(users)
      .where(isNull(users.deletedAt)),
    db
      .select({
        listed: sql<number>`count(*) filter (where ${tutorProfiles.isListed})`,
        identityPending: sql<number>`count(*) filter (where ${tutorProfiles.identityStatus} in ('pending','needs_info'))`,
        qualificationPending: sql<number>`count(*) filter (where ${tutorProfiles.qualificationStatus} in ('pending','needs_info'))`,
      })
      .from(tutorProfiles),
    db.select({ n: count() }).from(bookings).where(gte(bookings.createdAt, since30)),
    db.select({ n: count() }).from(challenges).where(eq(challenges.status, "in_review")),
    db.select({ n: count() }).from(reports).where(inArray(reports.status, ["open", "investigating"])),
    db.select({ n: count() }).from(refunds).where(eq(refunds.status, "requested")),
    db.select({ n: count() }).from(payouts).where(eq(payouts.status, "requested")),
    db.select({ n: count() }).from(studentRewards).where(eq(studentRewards.status, "pending_review")),
    db.select({ status: bookings.status, n: count() }).from(bookings).where(gte(bookings.createdAt, since30)).groupBy(bookings.status),
  ]);
  return {
    users: { total: u.total, students: Number(u.students), tutors: Number(u.tutors), admins: Number(u.admins), suspended: Number(u.suspended) },
    tutors: { listed: Number(t.listed), identityPending: Number(t.identityPending), qualificationPending: Number(t.qualificationPending) },
    bookings30: b.n,
    bookingsByStatus: bookingsByStatus.map((x) => ({ status: x.status, n: x.n })),
    challengesInReview: c.n,
    openReports: r.n,
    refundsRequested: rf.n,
    payoutsRequested: po.n,
    rewardsPending: rw.n,
    ledger: await platformTotals(),
  };
}

/** Bookings created per platform day for the last `days` days (oldest first). */
export async function bookingsPerDay(days = 14) {
  const since = new Date(Date.now() - (days - 1) * 86_400_000);
  const rows = await db
    .select({ day: sql<string>`to_char(${bookings.createdAt} at time zone 'Africa/Lagos', 'YYYY-MM-DD')`, n: count() })
    .from(bookings)
    .where(gte(bookings.createdAt, since))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const by = new Map(rows.map((r) => [r.day, r.n]));
  const out: { day: string; n: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    out.push({ day: key, n: by.get(key) ?? 0 });
  }
  return out;
}

export async function recentAudit(limit = 10) {
  return db
    .select({ entry: auditLogs, actorEmail: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export async function listUsers(f: { q?: string; role?: string; status?: string; page?: number }) {
  const p = page(f.page);
  const conds: SQL[] = [];
  if (f.q) conds.push(or(ilike(users.email, `%${f.q}%`), ilike(users.fullName, `%${f.q}%`))!);
  if (f.role === "student") conds.push(eq(users.isStudent, true));
  if (f.role === "tutor") conds.push(eq(users.isTutor, true));
  if (f.role === "admin") conds.push(sql`${users.adminRole} is not null`);
  if (f.status === "active" || f.status === "suspended" || f.status === "deleted") conds.push(eq(users.status, f.status));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(p.limit).offset(p.offset),
    db.select({ n: count() }).from(users).where(where),
  ]);
  return paged(rows, n, p.current);
}

export async function getUserDetail(id: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) return null;
  const [profile, [bk], [at], balance, [refs], [sess], credits, referredBy] = await Promise.all([
    user.isTutor ? db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, id) }) : Promise.resolve(null),
    db
      .select({
        asStudent: sql<number>`count(*) filter (where ${bookings.studentId} = ${id})`,
        asTutor: sql<number>`count(*) filter (where ${bookings.tutorId} = ${id})`,
      })
      .from(bookings)
      .where(or(eq(bookings.studentId, id), eq(bookings.tutorId, id))),
    db.select({ n: count() }).from(attempts).where(eq(attempts.userId, id)),
    creditBalance(id),
    db.select({ n: count() }).from(referrals).where(eq(referrals.referrerId, id)),
    db.select({ n: count() }).from(sessions).where(eq(sessions.userId, id)),
    db.select().from(creditEntries).where(eq(creditEntries.userId, id)).orderBy(desc(creditEntries.createdAt)).limit(25),
    user.referredByUserId ? db.query.users.findFirst({ where: eq(users.id, user.referredByUserId), columns: { id: true, email: true, fullName: true } }) : Promise.resolve(null),
  ]);
  return {
    user,
    profile: profile ?? null,
    counts: { bookingsAsStudent: Number(bk.asStudent), bookingsAsTutor: Number(bk.asTutor), attempts: at.n, referralsMade: refs.n, sessions: sess.n },
    creditBalance: balance,
    credits,
    referredBy: referredBy ?? null,
  };
}

export async function auditTrailFor(targetType: string, targetId: string, limit = 50) {
  return db
    .select({ entry: auditLogs, actorEmail: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(eq(auditLogs.targetType, targetType), eq(auditLogs.targetId, targetId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

export async function suspendUser(actor: AdminActor, userId: string, reason: string) {
  const role = requireRole(actor, MOD);
  if (userId === actor.id) throw new DomainError("You cannot suspend your own account.");
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!u) throw new DomainError("User not found.");
    if (u.status === "suspended") throw new DomainError("This account is already suspended.");
    if (u.adminRole && role !== "super") throw new DomainError("Only a super admin can suspend another admin.");
    await tx.update(users).set({ status: "suspended", updatedAt: new Date() }).where(eq(users.id, userId));
    const revoked = await tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
    if (u.isTutor) await tx.update(tutorProfiles).set({ isListed: false, updatedAt: new Date() }).where(eq(tutorProfiles.userId, userId));
    await audit({ actorId: actor.id, actorRole: role, action: "admin.user.suspended", targetType: "user", targetId: userId, before: { status: u.status }, after: { status: "suspended", reason, sessionsRevoked: revoked.length } }, tx);
    return { sessionsRevoked: revoked.length };
  });
}

export async function unsuspendUser(actor: AdminActor, userId: string, note: string) {
  const role = requireRole(actor, MOD);
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!u) throw new DomainError("User not found.");
    if (u.status !== "suspended") throw new DomainError("This account is not suspended.");
    await tx.update(users).set({ status: "active", updatedAt: new Date() }).where(eq(users.id, userId));
    await audit({ actorId: actor.id, actorRole: role, action: "admin.user.unsuspended", targetType: "user", targetId: userId, before: { status: u.status }, after: { status: "active", note } }, tx);
    await notify({ userId, type: "account.reinstated", title: "Your account has been reinstated", body: "You can sign in again. Thanks for your patience.", href: "/login", dedupeKey: `account:reinstated:${userId}:${Date.now()}` }, tx);
  });
}

export async function revokeUserSessions(actor: AdminActor, userId: string) {
  const role = requireRole(actor, MOD);
  return db.transaction(async (tx) => {
    const revoked = await tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
    await audit({ actorId: actor.id, actorRole: role, action: "admin.user.sessions_revoked", targetType: "user", targetId: userId, after: { sessionsRevoked: revoked.length } }, tx);
    return revoked.length;
  });
}

export async function setAdminRole(actor: AdminActor, userId: string, adminRole: AdminRole | null) {
  const role = requireRole(actor, SUPER);
  if (userId === actor.id) throw new DomainError("You cannot change your own admin role.");
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!u) throw new DomainError("User not found.");
    if (u.adminRole === adminRole) throw new DomainError("The user already has that role.");
    await tx.update(users).set({ adminRole, updatedAt: new Date() }).where(eq(users.id, userId));
    await audit({ actorId: actor.id, actorRole: role, action: adminRole ? "admin.user.admin_granted" : "admin.user.admin_revoked", targetType: "user", targetId: userId, before: { adminRole: u.adminRole }, after: { adminRole } }, tx);
    if (adminRole) await notify({ userId, type: "account.admin", title: "Admin access granted", body: `You now have ${adminRole} admin access.`, href: "/admin", dedupeKey: `admin:grant:${userId}:${adminRole}:${Date.now()}` }, tx);
  });
}

export async function addUserRole(actor: AdminActor, userId: string, which: "student" | "tutor") {
  const role = requireRole(actor, SUPER);
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!u) throw new DomainError("User not found.");
    if ((which === "student" && u.isStudent) || (which === "tutor" && u.isTutor)) throw new DomainError(`The user is already a ${which}.`);
    await tx.update(users).set(which === "student" ? { isStudent: true, updatedAt: new Date() } : { isTutor: true, updatedAt: new Date() }).where(eq(users.id, userId));
    if (which === "tutor") await tx.insert(tutorProfiles).values({ userId }).onConflictDoNothing();
    await audit({ actorId: actor.id, actorRole: role, action: "admin.user.role_added", targetType: "user", targetId: userId, before: { isStudent: u.isStudent, isTutor: u.isTutor }, after: { role: which } }, tx);
  });
}

export async function adjustCredit(actor: AdminActor, userId: string, amountNgn: Ngn, reason: string) {
  const role = requireRole(actor, FIN);
  const amount = ngn(amountNgn);
  if (toKobo(amount) <= 0n) throw new DomainError("Amount must be greater than zero.");
  if (reason.trim().length < 5) throw new DomainError("Give a reason (at least 5 characters).");
  return db.transaction(async (tx) => {
    const u = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (!u) throw new DomainError("User not found.");
    const before = await creditBalance(userId, tx);
    const row = await issueCredit({ userId, amountNgn: amount, type: "adjustment", source: "admin", reason: reason.trim(), idempotencyKey: `admin:${actor.id}:${Date.now()}`, createdBy: actor.id }, tx);
    const after = await creditBalance(userId, tx);
    await audit({ actorId: actor.id, actorRole: role, action: "admin.credit.adjustment", targetType: "user", targetId: userId, before: { balance: before }, after: { balance: after, amountNgn: amount, reason, entryId: row?.id ?? null } }, tx);
    await notify({ userId, type: "credit.adjustment", title: "Credit added to your account", body: `₦${Number(amount).toLocaleString("en-NG")} credit: ${reason.trim()}`, href: "/dashboard/credits", dedupeKey: row ? `notify:credit:${row.id}` : undefined }, tx);
    return row;
  });
}

export async function reverseCreditEntry(actor: AdminActor, entryId: string, reason: string) {
  const role = requireRole(actor, FIN);
  if (reason.trim().length < 5) throw new DomainError("Give a reason (at least 5 characters).");
  return db.transaction(async (tx) => {
    const entry = await tx.query.creditEntries.findFirst({ where: eq(creditEntries.id, entryId) });
    if (!entry) throw new DomainError("Credit entry not found.");
    const row = await reverseCredit(tx, { entryId, adminId: actor.id, reason: reason.trim() });
    await audit({ actorId: actor.id, actorRole: role, action: "admin.credit.reversed", targetType: "user", targetId: entry.userId, before: { entryId, amountNgn: entry.amountNgn, status: entry.status }, after: { reversalId: row?.id ?? null, reason } }, tx);
    return row;
  });
}

/* ------------------------------------------------------------------ */
/* Tutor verification                                                  */
/* ------------------------------------------------------------------ */

export type ReviewDecision = "verified" | "rejected" | "needs_info";

export async function listTutorQueue(f: { status?: string; q?: string; page?: number }) {
  const p = page(f.page);
  const conds: SQL[] = [];
  const status = f.status || "queue";
  if (status === "queue") conds.push(or(inArray(tutorProfiles.identityStatus, ["pending", "needs_info"]), inArray(tutorProfiles.qualificationStatus, ["pending", "needs_info"]))!);
  else if (status === "pending" || status === "needs_info" || status === "verified" || status === "rejected" || status === "not_submitted") conds.push(or(eq(tutorProfiles.identityStatus, status), eq(tutorProfiles.qualificationStatus, status))!);
  if (f.q) conds.push(or(ilike(users.email, `%${f.q}%`), ilike(users.fullName, `%${f.q}%`))!);
  const where = conds.length ? and(...conds) : undefined;
  const base = db.select({ profile: tutorProfiles, user: users }).from(tutorProfiles).innerJoin(users, eq(users.id, tutorProfiles.userId)).where(where);
  const [rows, [{ n }]] = await Promise.all([
    base.orderBy(asc(tutorProfiles.updatedAt)).limit(p.limit).offset(p.offset),
    db.select({ n: count() }).from(tutorProfiles).innerJoin(users, eq(users.id, tutorProfiles.userId)).where(where),
  ]);
  return paged(rows, n, p.current);
}

export async function getTutorDetail(tutorId: string) {
  const profile = await db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, tutorId) });
  if (!profile) return null;
  const [user, quals, [pk], trail] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, tutorId) }),
    db.select().from(tutorQualifications).where(eq(tutorQualifications.tutorId, tutorId)).orderBy(asc(tutorQualifications.createdAt)),
    db.select({ published: sql<number>`count(*) filter (where ${packages.status} = 'published')`, total: count() }).from(packages).where(eq(packages.tutorId, tutorId)),
    auditTrailFor("tutor", tutorId, 30),
  ]);
  if (!user) return null;
  return { profile, user, qualifications: quals, packages: { published: Number(pk.published), total: pk.total }, trail };
}

function decisionText(decision: ReviewDecision) {
  return decision === "verified" ? "approved" : decision === "rejected" ? "rejected" : "needs more information";
}

export async function reviewIdentity(actor: AdminActor, tutorId: string, decision: ReviewDecision, note: string) {
  const role = requireRole(actor, MOD);
  if (decision !== "verified" && note.trim().length < 3) throw new DomainError("Add a note so the tutor knows what to fix.");
  return db.transaction(async (tx) => {
    const [tp] = await tx.select().from(tutorProfiles).where(eq(tutorProfiles.userId, tutorId)).for("update");
    if (!tp) throw new DomainError("Tutor profile not found.");
    if (tp.identityStatus === "not_submitted") throw new DomainError("The tutor has not submitted an identity document yet.");
    const unlist = decision !== "verified" && tp.isListed;
    await tx
      .update(tutorProfiles)
      .set({ identityStatus: decision, identityReviewNote: note.trim() || null, ...(unlist ? { isListed: false } : {}), updatedAt: new Date() })
      .where(eq(tutorProfiles.userId, tutorId));
    await audit({ actorId: actor.id, actorRole: role, action: "admin.tutor.identity_reviewed", targetType: "tutor", targetId: tutorId, before: { identityStatus: tp.identityStatus, isListed: tp.isListed }, after: { identityStatus: decision, isListed: unlist ? false : tp.isListed, note } }, tx);
    await notify({ userId: tutorId, type: "verification.identity", title: `Identity verification ${decisionText(decision)}`, body: note.trim() || (decision === "verified" ? "Your identity document was verified." : ""), href: "/tutor/profile", dedupeKey: `verify:identity:${tutorId}:${decision}:${Date.now()}` }, tx);
    await recomputeTutorRank(tutorId, tx);
    return { unlisted: unlist };
  });
}

function overallQualificationStatus(statuses: string[]): "verified" | "rejected" | "pending" | "not_submitted" {
  if (!statuses.length) return "not_submitted";
  if (statuses.some((s) => s === "verified")) return "verified";
  if (statuses.every((s) => s === "rejected")) return "rejected";
  return "pending";
}

export async function reviewQualification(actor: AdminActor, qualificationId: string, decision: ReviewDecision, note: string) {
  const role = requireRole(actor, MOD);
  if (decision !== "verified" && note.trim().length < 3) throw new DomainError("Add a note so the tutor knows what to fix.");
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(tutorQualifications).where(eq(tutorQualifications.id, qualificationId)).for("update");
    if (!q) throw new DomainError("Qualification not found.");
    const [tp] = await tx.select().from(tutorProfiles).where(eq(tutorProfiles.userId, q.tutorId)).for("update");
    if (!tp) throw new DomainError("Tutor profile not found.");
    await tx.update(tutorQualifications).set({ status: decision, reviewNote: note.trim() || null }).where(eq(tutorQualifications.id, q.id));
    const all = await tx.select({ status: tutorQualifications.status }).from(tutorQualifications).where(eq(tutorQualifications.tutorId, q.tutorId));
    const overall = overallQualificationStatus(all.map((x) => x.status));
    await tx.update(tutorProfiles).set({ qualificationStatus: overall, qualificationReviewNote: note.trim() || tp.qualificationReviewNote, updatedAt: new Date() }).where(eq(tutorProfiles.userId, q.tutorId));
    await audit({ actorId: actor.id, actorRole: role, action: "admin.tutor.qualification_reviewed", targetType: "tutor", targetId: q.tutorId, before: { qualificationId: q.id, status: q.status, overall: tp.qualificationStatus }, after: { status: decision, overall, note } }, tx);
    await notify({ userId: q.tutorId, type: "verification.qualification", title: `Qualification “${q.title}” ${decisionText(decision)}`, body: note.trim() || (decision === "verified" ? "This qualification is now shown as verified." : ""), href: "/tutor/profile", dedupeKey: `verify:qual:${q.id}:${decision}:${Date.now()}` }, tx);
    await recomputeTutorRank(q.tutorId, tx);
    return { overall };
  });
}

export async function forceUnlist(actor: AdminActor, tutorId: string, reason: string) {
  const role = requireRole(actor, MOD);
  if (reason.trim().length < 5) throw new DomainError("Give a reason (at least 5 characters).");
  return db.transaction(async (tx) => {
    const [tp] = await tx.select().from(tutorProfiles).where(eq(tutorProfiles.userId, tutorId)).for("update");
    if (!tp) throw new DomainError("Tutor profile not found.");
    if (!tp.isListed) throw new DomainError("This tutor is not listed.");
    await tx.update(tutorProfiles).set({ isListed: false, updatedAt: new Date() }).where(eq(tutorProfiles.userId, tutorId));
    await audit({ actorId: actor.id, actorRole: role, action: "admin.tutor.force_unlisted", targetType: "tutor", targetId: tutorId, before: { isListed: true }, after: { isListed: false, reason } }, tx);
    await notify({ userId: tutorId, type: "listing.removed", title: "Your profile was removed from search", body: reason.trim(), href: "/tutor/profile", dedupeKey: `unlist:${tutorId}:${Date.now()}` }, tx);
    await recomputeTutorRank(tutorId, tx);
  });
}

/* ------------------------------------------------------------------ */
/* Bookings                                                            */
/* ------------------------------------------------------------------ */

const studentU = alias(users, "student_u");
const tutorU = alias(users, "tutor_u");

export async function listBookings(f: { status?: string; from?: string; to?: string; tutor?: string; student?: string; page?: number }) {
  const p = page(f.page);
  const conds: SQL[] = [];
  if (f.status && (bookings.status.enumValues as readonly string[]).includes(f.status)) conds.push(eq(bookings.status, f.status as (typeof bookings.status.enumValues)[number]));
  const r = dayRange(f.from, f.to);
  if (r.from) conds.push(gte(bookings.startsAt, r.from));
  if (r.to) conds.push(lte(bookings.startsAt, r.to));
  if (f.tutor) conds.push(or(ilike(tutorU.email, `%${f.tutor}%`), ilike(tutorU.fullName, `%${f.tutor}%`))!);
  if (f.student) conds.push(or(ilike(studentU.email, `%${f.student}%`), ilike(studentU.fullName, `%${f.student}%`))!);
  const where = conds.length ? and(...conds) : undefined;
  const base = () => db.select({ booking: bookings, studentEmail: studentU.email, tutorEmail: tutorU.email, studentName: studentU.fullName, tutorName: tutorU.fullName }).from(bookings).innerJoin(studentU, eq(studentU.id, bookings.studentId)).innerJoin(tutorU, eq(tutorU.id, bookings.tutorId)).where(where);
  const [rows, [{ n }]] = await Promise.all([
    base().orderBy(desc(bookings.startsAt)).limit(p.limit).offset(p.offset),
    db.select({ n: count() }).from(bookings).innerJoin(studentU, eq(studentU.id, bookings.studentId)).innerJoin(tutorU, eq(tutorU.id, bookings.tutorId)).where(where),
  ]);
  return paged(rows, n, p.current);
}

export async function getBookingDetail(id: string) {
  const b = await db.query.bookings.findFirst({ where: eq(bookings.id, id) });
  if (!b) return null;
  const [student, tutor, pkg, payment, ledger, refundRows, review, trail] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, b.studentId), columns: { id: true, email: true, fullName: true, status: true } }),
    db.query.users.findFirst({ where: eq(users.id, b.tutorId), columns: { id: true, email: true, fullName: true, status: true } }),
    db.query.packages.findFirst({ where: eq(packages.id, b.packageId) }),
    b.paymentId ? db.query.payments.findFirst({ where: eq(payments.id, b.paymentId) }) : Promise.resolve(null),
    db.select().from(ledgerEntries).where(eq(ledgerEntries.bookingId, id)).orderBy(asc(ledgerEntries.createdAt)),
    db.select().from(refunds).where(eq(refunds.bookingId, id)).orderBy(desc(refunds.createdAt)),
    db.query.reviews.findFirst({ where: eq(reviews.bookingId, id) }),
    auditTrailFor("booking", id, 50),
  ]);
  return { booking: b, student, tutor, pkg: pkg ?? null, payment: payment ?? null, ledger, refunds: refundRows, review: review ?? null, trail };
}

export async function resolveBookingDispute(actor: AdminActor, input: { bookingId: string; outcome: "completed" | "no_show_student" | "no_show_tutor" | "refunded"; refundPct: number; note: string }) {
  requireRole(actor, MOD);
  if (input.note.trim().length < 5) throw new DomainError("Add a resolution note (at least 5 characters).");
  await resolveDispute({ bookingId: input.bookingId, adminId: actor.id, outcome: input.outcome, refundPct: input.refundPct, note: input.note.trim() });
}

export async function adminCancelBooking(actor: AdminActor, bookingId: string, reason: string) {
  requireRole(actor, MOD);
  if (reason.trim().length < 5) throw new DomainError("Give a reason (at least 5 characters).");
  return cancelBooking({ bookingId, actorId: actor.id, role: "admin", reason: reason.trim() });
}

export async function addBookingNote(actor: AdminActor, bookingId: string, note: string) {
  const role = requireRole(actor, ALL);
  if (note.trim().length < 2) throw new DomainError("Write a note first.");
  const b = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId), columns: { id: true } });
  if (!b) throw new DomainError("Booking not found.");
  await audit({ actorId: actor.id, actorRole: role, action: "admin.booking.note", targetType: "booking", targetId: bookingId, after: { note: note.trim() } });
}

/* ------------------------------------------------------------------ */
/* Payments, refunds, payouts, reconciliation                          */
/* ------------------------------------------------------------------ */

export async function listPayments(f: { status?: string; purpose?: string; from?: string; to?: string; q?: string; page?: number }) {
  const p = page(f.page);
  const conds: SQL[] = [];
  if (f.status && (payments.status.enumValues as readonly string[]).includes(f.status)) conds.push(eq(payments.status, f.status as (typeof payments.status.enumValues)[number]));
  if (f.purpose === "booking" || f.purpose === "subscription") conds.push(eq(payments.purpose, f.purpose));
  const r = dayRange(f.from, f.to);
  if (r.from) conds.push(gte(payments.createdAt, r.from));
  if (r.to) conds.push(lte(payments.createdAt, r.to));
  if (f.q) conds.push(or(ilike(payments.reference, `%${f.q}%`), ilike(payments.providerRef, `%${f.q}%`), ilike(payments.providerTxId, `%${f.q}%`), ilike(users.email, `%${f.q}%`))!);
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db.select({ payment: payments, email: users.email, name: users.fullName }).from(payments).innerJoin(users, eq(users.id, payments.userId)).where(where).orderBy(desc(payments.createdAt)).limit(p.limit).offset(p.offset),
    db.select({ n: count() }).from(payments).innerJoin(users, eq(users.id, payments.userId)).where(where),
  ]);
  return paged(rows, n, p.current);
}

export async function getPaymentDetail(id: string) {
  const payment = await db.query.payments.findFirst({ where: eq(payments.id, id) });
  if (!payment) return null;
  const [user, ledger, events, refundRows, trail] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, payment.userId), columns: { id: true, email: true, fullName: true } }),
    db.select().from(ledgerEntries).where(eq(ledgerEntries.paymentId, id)).orderBy(asc(ledgerEntries.createdAt)),
    db
      .select()
      .from(webhookEvents)
      .where(sql`${webhookEvents.payload} -> 'data' ->> 'tx_ref' = ${payment.reference}`)
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(20),
    db.select().from(refunds).where(eq(refunds.paymentId, id)).orderBy(desc(refunds.createdAt)),
    auditTrailFor("payment", id, 30),
  ]);
  return { payment, user: user ?? null, ledger, events, refunds: refundRows, trail };
}

export async function reverifyPayment(actor: AdminActor, paymentId: string) {
  const role = requireRole(actor, FIN);
  const p = await db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!p) throw new DomainError("Payment not found.");
  const result = await reconcileByReference(p.reference, p.providerTxId);
  await audit({ actorId: actor.id, actorRole: role, action: "admin.payment.reverified", targetType: "payment", targetId: paymentId, before: { status: p.status }, after: { status: result.status, failureReason: result.failureReason } });
  return result;
}

export async function reconciliation() {
  const [ledger, [sum], orphans, errored] = await Promise.all([
    platformTotals(),
    db.select({ total: sql<string>`coalesce(sum(${payments.amountNgn}),0)`, n: count() }).from(payments).where(eq(payments.status, "successful")),
    db
      .select({ payment: payments, email: users.email })
      .from(payments)
      .innerJoin(users, eq(users.id, payments.userId))
      .where(and(eq(payments.status, "successful"), notExists(db.select({ one: sql`1` }).from(ledgerEntries).where(eq(ledgerEntries.paymentId, payments.id)))))
      .orderBy(desc(payments.createdAt))
      .limit(50),
    db.select().from(webhookEvents).where(eq(webhookEvents.outcome, "error")).orderBy(desc(webhookEvents.receivedAt)).limit(50),
  ]);
  const received = ledger.payment_received ?? "0.00";
  const successfulSum = fromKobo(toKobo(sum.total));
  return { ledger, successfulSum, successfulCount: sum.n, received, difference: fromKobo(toKobo(received) - toKobo(successfulSum)), orphans, errored };
}

/** Re-run a webhook event whose processing errored, with the stored payload. */
export async function retryWebhookEvent(actor: AdminActor, eventId: string) {
  const role = requireRole(actor, FIN);
  const ev = await db.query.webhookEvents.findFirst({ where: eq(webhookEvents.id, eventId) });
  if (!ev) throw new DomainError("Webhook event not found.");
  if (ev.outcome !== "error") throw new DomainError(`Only errored events can be retried (this one is ${ev.outcome ?? "unprocessed"}).`);
  // The event key is unique, so the failed row must make way for the re-run.
  await db.delete(webhookEvents).where(and(eq(webhookEvents.id, eventId), eq(webhookEvents.outcome, "error")));
  let outcome: string;
  try {
    outcome = (await handleWebhookEvent(ev.payload as Parameters<typeof handleWebhookEvent>[0])).outcome;
  } catch (e) {
    outcome = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
  await audit({ actorId: actor.id, actorRole: role, action: "admin.webhook.retried", targetType: "webhook_event", targetId: eventId, before: { eventKey: ev.eventKey, error: ev.error }, after: { outcome } });
  return outcome;
}

export async function financeApproveRefund(actor: AdminActor, refundId: string, note?: string | null) {
  requireRole(actor, FIN);
  return approveRefund(actor.id, refundId, note ?? null);
}

export async function financeRejectRefund(actor: AdminActor, refundId: string, note: string) {
  requireRole(actor, FIN);
  if (note.trim().length < 3) throw new DomainError("Add a note explaining the rejection.");
  return rejectRefund(actor.id, refundId, note.trim());
}

export async function financeExecuteRefund(actor: AdminActor, refundId: string) {
  requireRole(actor, FIN);
  return executeRefund(actor.id, refundId);
}

/* ------------------------------------------------------------------ */
/* Subscriptions & plans                                               */
/* ------------------------------------------------------------------ */

export async function listSubscriptions(f: { status?: string; plan?: string; source?: string; q?: string; page?: number }) {
  const p = page(f.page);
  const conds: SQL[] = [];
  if (f.status && (subscriptions.status.enumValues as readonly string[]).includes(f.status)) conds.push(eq(subscriptions.status, f.status as (typeof subscriptions.status.enumValues)[number]));
  if (f.plan && (subscriptions.planCode.enumValues as readonly string[]).includes(f.plan)) conds.push(eq(subscriptions.planCode, f.plan as (typeof subscriptions.planCode.enumValues)[number]));
  if (f.source && (subscriptions.source.enumValues as readonly string[]).includes(f.source)) conds.push(eq(subscriptions.source, f.source as (typeof subscriptions.source.enumValues)[number]));
  if (f.q) conds.push(or(ilike(users.email, `%${f.q}%`), ilike(users.fullName, `%${f.q}%`))!);
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({ sub: subscriptions, email: users.email, name: users.fullName, paymentRef: payments.reference })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.tutorId))
      .leftJoin(payments, eq(payments.id, subscriptions.paymentId))
      .where(where)
      .orderBy(desc(subscriptions.createdAt))
      .limit(p.limit)
      .offset(p.offset),
    db.select({ n: count() }).from(subscriptions).innerJoin(users, eq(users.id, subscriptions.tutorId)).where(where),
  ]);
  return paged(rows, n, p.current);
}

export async function cancelSubscriptionNow(actor: AdminActor, subscriptionId: string, reason: string) {
  const role = requireRole(actor, FIN);
  if (reason.trim().length < 5) throw new DomainError("Give a reason (at least 5 characters).");
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).for("update");
    if (!s) throw new DomainError("Subscription not found.");
    if (s.status === "cancelled" || s.status === "expired") throw new DomainError(`This subscription is already ${s.status}.`);
    await tx.update(subscriptions).set({ status: "cancelled", cancelledAt: new Date(), cancelAtPeriodEnd: false }).where(eq(subscriptions.id, s.id));
    await audit({ actorId: actor.id, actorRole: role, action: "admin.subscription.cancelled", targetType: "subscription", targetId: s.id, before: { status: s.status, endsAt: s.endsAt }, after: { status: "cancelled", reason } }, tx);
    await notify({ userId: s.tutorId, type: "subscription.cancelled", title: "Your plan was cancelled by TutorLink", body: `${reason.trim()} Your packages and history are unchanged. Historical bookings keep the commission rate that applied when they were booked.`, href: "/tutor/subscription", dedupeKey: `notify:sub:${s.id}:admin_cancelled` }, tx);
  });
}

export async function grantSubscriptionMonth(actor: AdminActor, tutorId: string, planCode: "premium" | "premium_plus", reason: string) {
  const role = requireRole(actor, FIN);
  if (reason.trim().length < 5) throw new DomainError("Give a reason (at least 5 characters).");
  return db.transaction(async (tx) => {
    const tp = await tx.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, tutorId) });
    if (!tp) throw new DomainError("That user is not a tutor.");
    const row = await grantPromotionalMonth(tx, { tutorId, planCode, idempotencyKey: `admin-grant:${actor.id}:${Date.now()}`, reason: reason.trim(), actorId: actor.id });
    await audit({ actorId: actor.id, actorRole: role, action: "admin.subscription.granted", targetType: "subscription", targetId: row?.id ?? tutorId, after: { tutorId, planCode, reason, startsAt: row?.startsAt, endsAt: row?.endsAt } }, tx);
    return row;
  });
}

export type PlanPatch = { monthlyFeeNgn: Ngn; commissionPct: Ngn; maxPublishedPackages: number | null; visibilityBoost: Ngn; profileBoostEligible: boolean; analyticsTools: boolean; active: boolean };

export async function updatePlan(actor: AdminActor, code: "free" | "premium" | "premium_plus", patch: PlanPatch) {
  const role = requireRole(actor, SUPER);
  if (toKobo(patch.commissionPct) < 0n || toKobo(patch.commissionPct) > 10000n) throw new DomainError("Commission must be between 0 and 100%.");
  if (toKobo(patch.monthlyFeeNgn) < 0n) throw new DomainError("Monthly fee cannot be negative.");
  if (patch.maxPublishedPackages !== null && patch.maxPublishedPackages < 0) throw new DomainError("Package limit cannot be negative.");
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.code, code)).for("update");
    if (!plan) throw new DomainError("Plan not found.");
    const [after] = await tx.update(subscriptionPlans).set(patch).where(eq(subscriptionPlans.code, code)).returning();
    await audit({ actorId: actor.id, actorRole: role, action: "admin.plan.updated", targetType: "plan", targetId: code, before: plan, after }, tx);
    return after;
  });
}

/* ------------------------------------------------------------------ */
/* Challenges                                                          */
/* ------------------------------------------------------------------ */

export async function listChallenges(f: { status?: string; q?: string; page?: number }) {
  const p = page(f.page);
  const conds: SQL[] = [];
  const status = f.status ?? "in_review";
  if (status !== "all" && (challenges.status.enumValues as readonly string[]).includes(status)) conds.push(eq(challenges.status, status as (typeof challenges.status.enumValues)[number]));
  if (f.q) conds.push(or(ilike(challenges.title, `%${f.q}%`), ilike(users.email, `%${f.q}%`))!);
  const where = conds.length ? and(...conds) : undefined;
  const attemptsCount = sql<number>`(select count(*) from ${attempts} where ${attempts.challengeId} = ${challenges.id})`;
  const [rows, [{ n }]] = await Promise.all([
    db.select({ challenge: challenges, creatorEmail: users.email, creatorName: users.fullName, attempts: attemptsCount }).from(challenges).innerJoin(users, eq(users.id, challenges.creatorId)).where(where).orderBy(desc(challenges.createdAt)).limit(p.limit).offset(p.offset),
    db.select({ n: count() }).from(challenges).innerJoin(users, eq(users.id, challenges.creatorId)).where(where),
  ]);
  return paged(rows.map((r) => ({ ...r, attempts: Number(r.attempts) })), n, p.current);
}

/** Admin-only: includes correct answers. Never pass this to a non-admin page. */
export async function getChallengeDetailForAdmin(id: string) {
  const c = await db.query.challenges.findFirst({ where: eq(challenges.id, id) });
  if (!c) return null;
  const [creator, qs, [stats], trail] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, c.creatorId), columns: { id: true, email: true, fullName: true, isTutor: true } }),
    db.select().from(questions).where(eq(questions.challengeId, id)).orderBy(asc(questions.position)),
    db
      .select({
        total: count(),
        submitted: sql<number>`count(*) filter (where ${attempts.status} = 'submitted')`,
        avgScore: sql<string | null>`avg(${attempts.score}) filter (where ${attempts.status} = 'submitted')`,
      })
      .from(attempts)
      .where(eq(attempts.challengeId, id)),
    auditTrailFor("challenge", id, 30),
  ]);
  return { challenge: c, creator: creator ?? null, questions: qs, stats: { total: stats.total, submitted: Number(stats.submitted), avgScore: stats.avgScore ? Number(stats.avgScore).toFixed(1) : null }, trail };
}

export async function archiveChallenge(actor: AdminActor, id: string, reason: string) {
  const role = requireRole(actor, MOD);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(challenges).where(eq(challenges.id, id)).for("update");
    if (!c) throw new DomainError("Challenge not found.");
    if (c.status === "archived") throw new DomainError("Already archived.");
    await tx.update(challenges).set({ status: "archived", reviewedBy: actor.id, reviewNote: reason.trim() || c.reviewNote, updatedAt: new Date() }).where(eq(challenges.id, id));
    await audit({ actorId: actor.id, actorRole: role, action: "admin.challenge.archived", targetType: "challenge", targetId: id, before: { status: c.status }, after: { status: "archived", reason } }, tx);
    await notify({ userId: c.creatorId, type: "challenge.archived", title: `Challenge “${c.title}” was archived`, body: reason.trim() || "An administrator archived this challenge.", href: "/tutor/challenges", dedupeKey: `challenge:archived:${id}` }, tx);
  });
}

/* ------------------------------------------------------------------ */
/* Referrals                                                           */
/* ------------------------------------------------------------------ */

const referrerU = alias(users, "referrer_u");
const referredU = alias(users, "referred_u");

export async function listReferrals(f: { flagged?: string; q?: string; page?: number }) {
  const p = page(f.page);
  const conds: SQL[] = [];
  if (f.flagged === "yes") conds.push(eq(referrals.flagged, true));
  if (f.flagged === "no") conds.push(eq(referrals.flagged, false));
  if (f.q) conds.push(or(ilike(referrerU.email, `%${f.q}%`), ilike(referredU.email, `%${f.q}%`))!);
  const where = conds.length ? and(...conds) : undefined;
  const sameIp = sql<boolean>`exists (select 1 from ${sessions} where ${sessions.userId} = ${referrals.referrerId} and ${sessions.ip} is not null and ${sessions.ip} = ${referrals.signupIp})`;
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({
        referral: referrals,
        referrerEmail: referrerU.email,
        referredEmail: referredU.email,
        referredOnboarding: referredU.onboardingStep,
        referredCreatedAt: referredU.createdAt,
        sameIp,
      })
      .from(referrals)
      .innerJoin(referrerU, eq(referrerU.id, referrals.referrerId))
      .innerJoin(referredU, eq(referredU.id, referrals.referredUserId))
      .where(where)
      .orderBy(desc(referrals.createdAt))
      .limit(p.limit)
      .offset(p.offset),
    db.select({ n: count() }).from(referrals).innerJoin(referrerU, eq(referrerU.id, referrals.referrerId)).innerJoin(referredU, eq(referredU.id, referrals.referredUserId)).where(where),
  ]);
  const ids = rows.map((r) => r.referral.id);
  const events = ids.length
    ? await db
        .select({ event: referralEvents, creditStatus: creditEntries.status })
        .from(referralEvents)
        .leftJoin(creditEntries, eq(creditEntries.id, referralEvents.creditEntryId))
        .where(inArray(referralEvents.referralId, ids))
        .orderBy(asc(referralEvents.createdAt))
    : [];
  const byRef = new Map<string, typeof events>();
  for (const e of events) {
    const list = byRef.get(e.event.referralId) ?? [];
    list.push(e);
    byRef.set(e.event.referralId, list);
  }
  return paged(
    rows.map((r) => ({
      ...r,
      sameIp: Boolean(r.sameIp),
      incompleteOnboarding: r.referredOnboarding !== "complete" && Date.now() - r.referredCreatedAt.getTime() > 3 * 86_400_000,
      events: byRef.get(r.referral.id) ?? [],
    })),
    n,
    p.current,
  );
}

export async function setReferralFlag(actor: AdminActor, referralId: string, flagged: boolean, reason: string) {
  const role = requireRole(actor, MOD);
  if (flagged && reason.trim().length < 5) throw new DomainError("Give a reason (at least 5 characters).");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(referrals).where(eq(referrals.id, referralId)).for("update");
    if (!r) throw new DomainError("Referral not found.");
    if (r.flagged === flagged) throw new DomainError(`Referral is already ${flagged ? "flagged" : "unflagged"}.`);
    await tx.update(referrals).set({ flagged, flagReason: flagged ? reason.trim() : null }).where(eq(referrals.id, referralId));
    await audit({ actorId: actor.id, actorRole: role, action: flagged ? "admin.referral.flagged" : "admin.referral.unflagged", targetType: "referral", targetId: referralId, before: { flagged: r.flagged, flagReason: r.flagReason }, after: { flagged, reason } }, tx);
  });
}

/* ------------------------------------------------------------------ */
/* Rewards & cycles                                                    */
/* ------------------------------------------------------------------ */

export async function listCycles() {
  const rows = await db.select().from(leaderboardCycles).orderBy(desc(leaderboardCycles.startsAt)).limit(24);
  const now = Date.now();
  return rows.map((c) => ({ ...c, ended: c.endsAt.getTime() <= now }));
}

export async function listStudentRewards(f: { status?: string; cycle?: string; page?: number }) {
  const p = page(f.page);
  const conds: SQL[] = [];
  if (f.status && (studentRewards.status.enumValues as readonly string[]).includes(f.status)) conds.push(eq(studentRewards.status, f.status as (typeof studentRewards.status.enumValues)[number]));
  if (f.cycle) conds.push(eq(studentRewards.cycleId, f.cycle));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({ reward: studentRewards, email: users.email, name: users.fullName, cycleStartsAt: leaderboardCycles.startsAt, cycleEndsAt: leaderboardCycles.endsAt })
      .from(studentRewards)
      .innerJoin(users, eq(users.id, studentRewards.userId))
      .innerJoin(leaderboardCycles, eq(leaderboardCycles.id, studentRewards.cycleId))
      .where(where)
      .orderBy(desc(studentRewards.createdAt), asc(studentRewards.rank))
      .limit(p.limit)
      .offset(p.offset),
    db.select({ n: count() }).from(studentRewards).where(where),
  ]);
  return paged(rows, n, p.current);
}

export async function listTutorRewards(f: { status?: string; page?: number }) {
  const p = page(f.page);
  const where = f.status && (tutorRewards.status.enumValues as readonly string[]).includes(f.status) ? eq(tutorRewards.status, f.status as (typeof tutorRewards.status.enumValues)[number]) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({ reward: tutorRewards, email: users.email, name: users.fullName, cycleStartsAt: leaderboardCycles.startsAt, cycleEndsAt: leaderboardCycles.endsAt })
      .from(tutorRewards)
      .innerJoin(users, eq(users.id, tutorRewards.tutorId))
      .innerJoin(leaderboardCycles, eq(leaderboardCycles.id, tutorRewards.cycleId))
      .where(where)
      .orderBy(desc(tutorRewards.createdAt))
      .limit(p.limit)
      .offset(p.offset),
    db.select({ n: count() }).from(tutorRewards).where(where),
  ]);
  return paged(rows, n, p.current);
}

export async function setCycleBudget(actor: AdminActor, cycleId: string, budgetNgn: Ngn) {
  const role = requireRole(actor, FIN);
  const budget = ngn(budgetNgn);
  if (toKobo(budget) < 0n) throw new DomainError("Budget cannot be negative.");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(leaderboardCycles).where(eq(leaderboardCycles.id, cycleId)).for("update");
    if (!c) throw new DomainError("Cycle not found.");
    if (c.status === "rewarded") throw new DomainError("This cycle has already been rewarded; its budget is final.");
    await tx.update(leaderboardCycles).set({ budgetNgn: budget }).where(eq(leaderboardCycles.id, cycleId));
    await audit({ actorId: actor.id, actorRole: role, action: "admin.cycle.budget_updated", targetType: "cycle", targetId: cycleId, before: { budgetNgn: c.budgetNgn }, after: { budgetNgn: budget } }, tx);
  });
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export const REPORT_REASONS = ["harassment", "fraud", "no_show", "unsafe", "inappropriate_content", "other"] as const;
export const REPORT_TARGETS = ["user", "booking", "challenge", "review"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export async function listReports(f: { status?: string; type?: string; page?: number }) {
  const p = page(f.page);
  const conds: SQL[] = [];
  const status = f.status ?? "open";
  if (status !== "all" && (reports.status.enumValues as readonly string[]).includes(status)) conds.push(eq(reports.status, status as (typeof reports.status.enumValues)[number]));
  if (f.type && (REPORT_TARGETS as readonly string[]).includes(f.type)) conds.push(eq(reports.targetType, f.type));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db.select({ report: reports, reporterEmail: users.email }).from(reports).innerJoin(users, eq(users.id, reports.reporterId)).where(where).orderBy(desc(reports.createdAt)).limit(p.limit).offset(p.offset),
    db.select({ n: count() }).from(reports).where(where),
  ]);
  return paged(rows, n, p.current);
}

export type ResolvedTarget =
  | { type: "user"; href: string; label: string; user: { id: string; email: string; fullName: string; status: string; isTutor: boolean } }
  | { type: "booking"; href: string; label: string; booking: { id: string; status: string; studentId: string; tutorId: string; startsAt: Date } }
  | { type: "challenge"; href: string; label: string; challenge: { id: string; title: string; status: string; creatorId: string } }
  | { type: "review"; href: string; label: string; review: { id: string; rating: number; comment: string | null; status: string; tutorId: string; studentId: string } }
  | { type: "missing"; href: null; label: string };

export async function resolveTarget(type: string, id: string): Promise<ResolvedTarget> {
  if (type === "user") {
    const u = await db.query.users.findFirst({ where: eq(users.id, id), columns: { id: true, email: true, fullName: true, status: true, isTutor: true } });
    return u ? { type: "user", href: `/admin/users/${u.id}`, label: `${u.fullName} (${u.email})`, user: u } : { type: "missing", href: null, label: "User no longer exists" };
  }
  if (type === "booking") {
    const b = await db.query.bookings.findFirst({ where: eq(bookings.id, id), columns: { id: true, status: true, studentId: true, tutorId: true, startsAt: true } });
    return b ? { type: "booking", href: `/admin/bookings/${b.id}`, label: `Booking ${b.id.slice(0, 8)} · ${b.status.replaceAll("_", " ")}`, booking: b } : { type: "missing", href: null, label: "Booking not found" };
  }
  if (type === "challenge") {
    const c = await db.query.challenges.findFirst({ where: eq(challenges.id, id), columns: { id: true, title: true, status: true, creatorId: true } });
    return c ? { type: "challenge", href: `/admin/challenges/${c.id}`, label: c.title, challenge: c } : { type: "missing", href: null, label: "Challenge not found" };
  }
  if (type === "review") {
    const r = await db.query.reviews.findFirst({ where: eq(reviews.id, id) });
    return r ? { type: "review", href: `/admin/bookings/${r.bookingId}`, label: `${r.rating}★ review`, review: { id: r.id, rating: r.rating, comment: r.comment, status: r.status, tutorId: r.tutorId, studentId: r.studentId } } : { type: "missing", href: null, label: "Review not found" };
  }
  return { type: "missing", href: null, label: "Unknown target type" };
}

export async function getReportDetail(id: string) {
  const r = await db.query.reports.findFirst({ where: eq(reports.id, id) });
  if (!r) return null;
  const [reporter, target, handler, trail] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, r.reporterId), columns: { id: true, email: true, fullName: true } }),
    resolveTarget(r.targetType, r.targetId),
    r.handledBy ? db.query.users.findFirst({ where: eq(users.id, r.handledBy), columns: { id: true, email: true } }) : Promise.resolve(null),
    auditTrailFor("report", id, 30),
  ]);
  return { report: r, reporter: reporter ?? null, target, handler: handler ?? null, trail };
}

export async function setReportStatus(actor: AdminActor, reportId: string, status: "investigating" | "resolved" | "dismissed", note: string) {
  const role = requireRole(actor, MOD);
  if (status !== "investigating" && note.trim().length < 3) throw new DomainError("Add a resolution note.");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(reports).where(eq(reports.id, reportId)).for("update");
    if (!r) throw new DomainError("Report not found.");
    await tx.update(reports).set({ status, handledBy: actor.id, resolutionNote: note.trim() || r.resolutionNote, updatedAt: new Date() }).where(eq(reports.id, reportId));
    await audit({ actorId: actor.id, actorRole: role, action: "admin.report.status", targetType: "report", targetId: reportId, before: { status: r.status }, after: { status, note } }, tx);
    if (status !== "investigating") {
      await notify({ userId: r.reporterId, type: "report.closed", title: status === "resolved" ? "Your report was resolved" : "Your report was reviewed", body: status === "resolved" ? "Thank you. We took action on the report you submitted." : "We reviewed your report and did not find a policy breach. Thank you for helping keep TutorLink safe.", href: "/notifications", dedupeKey: `report:closed:${reportId}` }, tx);
    }
  });
}

export async function hideReview(actor: AdminActor, reviewId: string, reason: string) {
  const role = requireRole(actor, MOD);
  return db.transaction(async (tx) => {
    const [rv] = await tx.select().from(reviews).where(eq(reviews.id, reviewId)).for("update");
    if (!rv) throw new DomainError("Review not found.");
    if (rv.status === "hidden") throw new DomainError("This review is already hidden.");
    await tx.update(reviews).set({ status: "hidden" }).where(eq(reviews.id, reviewId));
    await audit({ actorId: actor.id, actorRole: role, action: "admin.review.hidden", targetType: "review", targetId: reviewId, before: { status: rv.status }, after: { status: "hidden", reason } }, tx);
    await recomputeTutorRank(rv.tutorId, tx);
  });
}

/** Public: a signed-in user reports a user, booking, challenge or review. */
export async function createReport(reporterId: string, input: { targetType: ReportTarget; targetId: string; reason: (typeof REPORT_REASONS)[number]; details: string }) {
  const target = await resolveTarget(input.targetType, input.targetId);
  if (target.type === "missing") throw new DomainError("The item you are reporting could not be found.");
  if (target.type === "user" && target.user.id === reporterId) throw new DomainError("You cannot report yourself.");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(reports).values({ reporterId, targetType: input.targetType, targetId: input.targetId, reason: input.reason, details: input.details.trim() || null }).returning();
    await audit({ actorId: reporterId, actorRole: "user", action: "report.created", targetType: "report", targetId: row.id, after: { targetType: input.targetType, targetId: input.targetId, reason: input.reason } }, tx);
    const admins = await tx.select({ id: users.id }).from(users).where(and(inArray(users.adminRole, ["moderator", "super"]), eq(users.status, "active")));
    for (const a of admins) {
      await notify({ userId: a.id, type: "report.new", title: `New ${input.targetType} report: ${input.reason.replaceAll("_", " ")}`, body: target.label, href: `/admin/reports/${row.id}`, dedupeKey: `report:${row.id}:${a.id}` }, tx);
    }
    return row;
  });
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const settingDescriptions: Record<SettingKey, string> = {
  "booking.hold_minutes": "How long a booking slot is reserved while the student pays before it is released.",
  "booking.min_lead_hours": "Earliest a session may start after it is booked, in hours.",
  "booking.max_days_ahead": "How far in the future a session can be booked, in days.",
  "booking.free_cancel_hours": "A student who cancels at least this many hours before the session gets a full refund.",
  "booking.late_cancel_refund_pct": "Refund percentage when a student cancels inside the free-cancellation window.",
  "booking.tutor_cancel_penalty_strikes": "Number of tutor cancellations before penalties apply to the tutor.",
  "booking.auto_complete_hours": "Hours after a session ends before it is automatically marked completed if nobody disputes it.",
  "booking.review_window_days": "Days after completion during which a student can leave a review.",
  "plans.free_max_published_packages": "Maximum number of published packages on the Free plan.",
  "payments.processing_fee_pct": "Card processing fee percentage charged by the payment provider (absorbed on the platform side).",
  "payments.processing_fee_cap_ngn": "Maximum processing fee per transaction, in naira.",
  "payments.refund_fee_policy": "Who absorbs the processing fee on refunds: platform_absorbs or deduct_from_refund.",
  "referral.student_verified_ngn": "Credit (naira) paid to a referrer when a referred student verifies and completes onboarding.",
  "referral.student_first_session_ngn": "Credit (naira) paid when a referred student completes their first qualifying session.",
  "referral.tutor_paid_upgrade_ngn": "Credit (naira) paid when a referred tutor buys a paid plan.",
  "referral.tutor_five_sessions_ngn": "Credit (naira) paid when a referred tutor completes five qualifying sessions.",
  "referral.min_qualifying_session_ngn": "Sessions priced below this amount do not count towards referral milestones.",
  "referral.credit_expiry_days": "Days before unused referral credit expires.",
  "credits.max_redeem_pct_of_booking": "Largest share of a booking's price that can be paid with credits.",
  "challenge.default_time_limit_seconds": "Default time limit for a new challenge, in seconds.",
  "challenge.default_max_attempts": "Default number of attempts a student gets per challenge.",
  "challenge.require_review_for_tutor_challenges": "When on, tutor-created challenges must be approved by a moderator before publishing.",
  "challenge.daily_cutoff_timezone": "Time zone that defines the platform day for daily challenges.",
  "challenge.max_attempts_per_user_per_day": "Anti-abuse cap on challenge attempts per user per day.",
  "leaderboard.cycle_days": "Length of a leaderboard cycle, in days.",
  "leaderboard.top_n": "How many top students per scope are eligible for rewards.",
  "leaderboard.reward_ngn": "Reward amount (naira) for a winning student.",
  "leaderboard.cash_requires_active_subscription": "When on, cash rewards require an active paid subscription (otherwise the reward is paid as credit).",
  "leaderboard.cash_requires_paid_session_in_cycle": "When on, cash rewards require at least one paid session during the cycle.",
  "leaderboard.cash_min_paid_session_ngn": "Minimum paid-session price that qualifies a student for a cash reward.",
  "leaderboard.min_attempts_for_eligibility": "Minimum submitted attempts in a cycle before a student can win a reward.",
  "leaderboard.cycle_budget_ngn": "Default total reward budget (naira) for a new cycle.",
  "tutor_reward.min_unique_participants": "Minimum unique participants a tutor's challenges need before an engagement reward is considered.",
  "tutor_reward.min_completion_rate_pct": "Minimum completion rate (%) of a tutor's challenges for an engagement reward.",
  "ranking.bayesian_prior_rating": "Rating assumed for tutors with few reviews (keeps a single 5-star review from dominating).",
  "ranking.bayesian_prior_weight": "How many 'virtual' reviews the prior rating counts for.",
  "ranking.new_tutor_boost_days": "Days during which new tutors get a fading visibility boost.",
  "ranking.new_tutor_boost": "Size of the new-tutor boost added to the rank score on day one.",
  "payouts.min_amount_ngn": "Smallest payout a tutor can request, in naira.",
  "payouts.require_admin_approval": "When on, payouts must be approved by finance before any transfer is attempted.",
  "safety.minimum_age": "Minimum age for an account holder.",
};

export async function listSettingsWithValues() {
  const rows = await db.select().from(platformSettings);
  const stored = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(settingDefaults) as SettingKey[]).map((key) => {
    const def = settingDefaults[key];
    const row = stored.get(key);
    const value = row ? (row.value as unknown) : def;
    return { key, type: typeof def as "number" | "boolean" | "string", defaultValue: def as unknown, value, overridden: !!row, updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null, description: settingDescriptions[key] };
  });
}

export function coerceSettingValue(key: SettingKey, raw: string | undefined): unknown {
  const def = settingDefaults[key];
  if (typeof def === "number") {
    const n = Number(String(raw ?? "").trim());
    if (!Number.isFinite(n)) throw new DomainError(`${key} must be a number.`);
    if (n < 0) throw new DomainError(`${key} cannot be negative.`);
    return n;
  }
  if (typeof def === "boolean") return raw === "true" || raw === "on" || raw === "1";
  const s = String(raw ?? "").trim();
  if (!s) throw new DomainError(`${key} cannot be empty.`);
  if (key === "payments.refund_fee_policy" && !["platform_absorbs", "deduct_from_refund"].includes(s)) throw new DomainError("Refund fee policy must be platform_absorbs or deduct_from_refund.");
  return s;
}

export async function updateSetting(actor: AdminActor, key: string, raw: string | undefined) {
  const role = requireRole(actor, SUPER);
  if (!(key in settingDefaults)) throw new DomainError("Unknown setting.");
  const k = key as SettingKey;
  const value = coerceSettingValue(k, raw);
  const existing = await db.query.platformSettings.findFirst({ where: eq(platformSettings.key, k) });
  const before = existing ? existing.value : settingDefaults[k];
  await setSetting(k, value, actor.id);
  await audit({ actorId: actor.id, actorRole: role, action: "admin.setting.updated", targetType: "setting", targetId: k, before: { value: before }, after: { value } });
  return value;
}

/* ------------------------------------------------------------------ */
/* Audit log                                                           */
/* ------------------------------------------------------------------ */

export async function listAudit(f: { actor?: string; action?: string; targetType?: string; targetId?: string; from?: string; to?: string; page?: number }) {
  const p = page(f.page);
  const conds: SQL[] = [];
  if (f.actor) {
    const ids = /^[0-9a-f-]{36}$/i.test(f.actor) ? [f.actor] : await lookupUserIds(f.actor);
    conds.push(ids.length ? inArray(auditLogs.actorId, ids) : sql`false`);
  }
  if (f.action) conds.push(ilike(auditLogs.action, `%${f.action}%`));
  if (f.targetType) conds.push(eq(auditLogs.targetType, f.targetType));
  if (f.targetId) conds.push(eq(auditLogs.targetId, f.targetId));
  const r = dayRange(f.from, f.to);
  if (r.from) conds.push(gte(auditLogs.createdAt, r.from));
  if (r.to) conds.push(lte(auditLogs.createdAt, r.to));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db.select({ entry: auditLogs, actorEmail: users.email }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).where(where).orderBy(desc(auditLogs.createdAt)).limit(p.limit).offset(p.offset),
    db.select({ n: count() }).from(auditLogs).where(where),
  ]);
  return paged(rows, n, p.current);
}

export async function listAuditTargetTypes() {
  const rows = await db.selectDistinct({ t: auditLogs.targetType }).from(auditLogs).where(sql`${auditLogs.targetType} is not null`).orderBy(asc(auditLogs.targetType));
  return rows.map((r) => r.t!).filter(Boolean);
}

