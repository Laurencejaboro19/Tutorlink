import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, creditEntries, notifications, payments, platformSettings, refunds, reports, sessions, tutorProfiles, tutorQualifications, users } from "@/db/schema";
import { AuthError } from "@/lib/auth";
import { DomainError } from "@/lib/result";
import { clearSettingsCache, getSetting } from "@/lib/settings";
import {
  addUserRole,
  adjustCredit,
  createReport,
  financeApproveRefund,
  listSettingsWithValues,
  listUsers,
  overviewStats,
  requireRole,
  reverseCreditEntry,
  reviewIdentity,
  reviewQualification,
  setAdminRole,
  suspendUser,
  unsuspendUser,
  updateSetting,
  type AdminActor,
} from "@/server/admin";
import { creditBalance } from "@/server/credits";
import { createUser, truncateAll } from "./setup";

async function admin(role: "super" | "moderator" | "finance"): Promise<AdminActor> {
  const u = await createUser({ adminRole: role, name: `${role} admin` });
  return { id: u.id, adminRole: u.adminRole };
}

async function pendingTutor() {
  const u = await createUser({ roles: ["tutor"], name: "Pending Tutor" });
  await db.update(tutorProfiles).set({ identityStatus: "pending", identityDocumentType: "nin", identityDocumentRef: "private/nin/abc", isListed: true }).where(eq(tutorProfiles.userId, u.id));
  return u;
}

async function auditRows(targetType: string, targetId: string) {
  return db.select().from(auditLogs).where(and(eq(auditLogs.targetType, targetType), eq(auditLogs.targetId, targetId)));
}

describe("admin permission model", () => {
  beforeEach(async () => {
    await truncateAll();
    clearSettingsCache();
  });

  it("rejects a non-admin calling an admin service function", async () => {
    const plain = await createUser({ isStudent: true });
    const target = await createUser({ isStudent: true });
    await expect(suspendUser({ id: plain.id, adminRole: null }, target.id, "no reason at all")).rejects.toBeInstanceOf(AuthError);
    await expect(updateSetting({ id: plain.id, adminRole: null }, "booking.hold_minutes", "15")).rejects.toBeInstanceOf(AuthError);
    expect(() => requireRole({ id: plain.id, adminRole: undefined }, ["super"])).toThrow(AuthError);
    expect(await auditRows("user", target.id)).toHaveLength(0);
  });

  it("finance cannot verify tutors", async () => {
    const fin = await admin("finance");
    const tutor = await pendingTutor();
    await expect(reviewIdentity(fin, tutor.id, "verified", "")).rejects.toBeInstanceOf(AuthError);
    const tp = await db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, tutor.id) });
    expect(tp?.identityStatus).toBe("pending");
  });

  it("moderator cannot approve refunds (and the refund stays requested)", async () => {
    const mod = await admin("moderator");
    const student = await createUser({ isStudent: true });
    const [payment] = await db.insert(payments).values({ reference: "TL-BK-TEST1", userId: student.id, purpose: "booking", amountNgn: "10000.00", status: "successful", providerTxId: "123" }).returning();
    const [refund] = await db.insert(refunds).values({ paymentId: payment.id, requestedBy: student.id, amountNgn: "10000.00", reason: "test", status: "requested" }).returning();
    await expect(financeApproveRefund(mod, refund.id, "ok")).rejects.toBeInstanceOf(AuthError);
    const after = await db.query.refunds.findFirst({ where: eq(refunds.id, refund.id) });
    expect(after?.status).toBe("requested");
    // finance can
    const fin = await admin("finance");
    const approved = await financeApproveRefund(fin, refund.id, "ok");
    expect(approved.status).toBe("approved");
  });

  it("moderator cannot issue credit adjustments; finance can and it is audited", async () => {
    const mod = await admin("moderator");
    const fin = await admin("finance");
    const student = await createUser({ isStudent: true });
    await expect(adjustCredit(mod, student.id, "500", "Goodwill credit")).rejects.toBeInstanceOf(AuthError);
    const row = await adjustCredit(fin, student.id, "500", "Goodwill credit");
    expect(row?.type).toBe("adjustment");
    expect(row?.idempotencyKey.startsWith(`admin:${fin.id}:`)).toBe(true);
    expect(await creditBalance(student.id)).toBe("500.00");
    const trail = await auditRows("user", student.id);
    expect(trail.some((a) => a.action === "admin.credit.adjustment" && (a.after as { balance: string }).balance === "500.00")).toBe(true);
    // reversal
    await reverseCreditEntry(fin, row!.id, "Issued by mistake");
    expect(await creditBalance(student.id)).toBe("0.00");
    const entries = await db.select().from(creditEntries).where(eq(creditEntries.userId, student.id));
    expect(entries.find((e) => e.id === row!.id)?.status).toBe("reversed");
  });
});

describe("tutor verification", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("identity approve sets verified, writes an audit row and notifies the tutor", async () => {
    const mod = await admin("moderator");
    const tutor = await pendingTutor();
    const result = await reviewIdentity(mod, tutor.id, "verified", "Looks good");
    expect(result.unlisted).toBe(false);
    const tp = await db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, tutor.id) });
    expect(tp?.identityStatus).toBe("verified");
    expect(tp?.identityReviewNote).toBe("Looks good");
    expect(tp?.isListed).toBe(true);
    const trail = await auditRows("tutor", tutor.id);
    const entry = trail.find((a) => a.action === "admin.tutor.identity_reviewed");
    expect(entry).toBeTruthy();
    expect(entry?.actorId).toBe(mod.id);
    expect((entry?.before as { identityStatus: string }).identityStatus).toBe("pending");
    expect((entry?.after as { identityStatus: string }).identityStatus).toBe("verified");
    const notes = await db.select().from(notifications).where(eq(notifications.userId, tutor.id));
    expect(notes.some((n) => n.type === "verification.identity")).toBe(true);
  });

  it("identity reject unlists the tutor and requires a note", async () => {
    const sup = await admin("super");
    const tutor = await pendingTutor();
    await expect(reviewIdentity(sup, tutor.id, "rejected", "")).rejects.toBeInstanceOf(DomainError);
    const result = await reviewIdentity(sup, tutor.id, "rejected", "Document unreadable");
    expect(result.unlisted).toBe(true);
    const tp = await db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, tutor.id) });
    expect(tp?.identityStatus).toBe("rejected");
    expect(tp?.isListed).toBe(false);
  });

  it("qualification status is derived from the individual qualifications", async () => {
    const mod = await admin("moderator");
    const tutor = await pendingTutor();
    const [q1, q2] = await db
      .insert(tutorQualifications)
      .values([
        { tutorId: tutor.id, title: "B.Sc Mathematics", institution: "UNILAG", status: "pending" },
        { tutorId: tutor.id, title: "PGDE", institution: "NTI", status: "pending" },
      ])
      .returning();
    let r = await reviewQualification(mod, q1.id, "rejected", "Not a real certificate");
    expect(r.overall).toBe("pending"); // q2 still pending
    r = await reviewQualification(mod, q2.id, "rejected", "Expired");
    expect(r.overall).toBe("rejected");
    r = await reviewQualification(mod, q1.id, "verified", "");
    expect(r.overall).toBe("verified");
    const tp = await db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, tutor.id) });
    expect(tp?.qualificationStatus).toBe("verified");
  });
});

describe("users", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("suspend deletes sessions so the user can no longer resolve a session, and unsuspend restores access", async () => {
    const mod = await admin("moderator");
    const victim = await createUser({ isStudent: true });
    await db.insert(sessions).values([
      { tokenHash: "h1", userId: victim.id, expiresAt: new Date(Date.now() + 86_400_000) },
      { tokenHash: "h2", userId: victim.id, expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    const r = await suspendUser(mod, victim.id, "Abusive messages to tutors");
    expect(r.sessionsRevoked).toBe(2);
    // getCurrentUser-equivalent: join sessions → users, require active status
    const resolved = await db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.userId, victim.id), eq(users.status, "active")));
    expect(resolved).toHaveLength(0);
    const u = await db.query.users.findFirst({ where: eq(users.id, victim.id) });
    expect(u?.status).toBe("suspended");
    await expect(suspendUser(mod, victim.id, "again please")).rejects.toBeInstanceOf(DomainError);
    await unsuspendUser(mod, victim.id, "appeal accepted");
    expect((await db.query.users.findFirst({ where: eq(users.id, victim.id) }))?.status).toBe("active");
    const trail = await auditRows("user", victim.id);
    expect(trail.map((a) => a.action)).toEqual(expect.arrayContaining(["admin.user.suspended", "admin.user.unsuspended"]));
  });

  it("super cannot demote self; moderator cannot change roles", async () => {
    const sup = await admin("super");
    const mod = await admin("moderator");
    await expect(setAdminRole(sup, sup.id, null)).rejects.toBeInstanceOf(DomainError);
    await expect(setAdminRole(sup, sup.id, "finance")).rejects.toBeInstanceOf(DomainError);
    await expect(setAdminRole(mod, sup.id, null)).rejects.toBeInstanceOf(AuthError);
    expect((await db.query.users.findFirst({ where: eq(users.id, sup.id) }))?.adminRole).toBe("super");
    // super can change others
    await setAdminRole(sup, mod.id, "finance");
    expect((await db.query.users.findFirst({ where: eq(users.id, mod.id) }))?.adminRole).toBe("finance");
    await setAdminRole(sup, mod.id, null);
    expect((await db.query.users.findFirst({ where: eq(users.id, mod.id) }))?.adminRole).toBeNull();
  });

  it("super can add a tutor role (creates an empty profile) and search finds the user", async () => {
    const sup = await admin("super");
    const u = await createUser({ isStudent: true, email: "findme@test.local", name: "Find Me" });
    await addUserRole(sup, u.id, "tutor");
    expect(await db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, u.id) })).toBeTruthy();
    const found = await listUsers({ q: "findme", role: "tutor" });
    expect(found.rows.map((r) => r.id)).toContain(u.id);
    const stats = await overviewStats();
    expect(stats.users.tutors).toBeGreaterThanOrEqual(1);
  });
});

describe("settings", () => {
  beforeEach(async () => {
    await truncateAll();
    await db.delete(platformSettings); // not covered by truncateAll (reference-like table)
    clearSettingsCache();
  });

  it("update persists, clears the cache and is audited; only super may change settings", async () => {
    const sup = await admin("super");
    const fin = await admin("finance");
    expect(await getSetting("booking.hold_minutes")).toBe(20); // cached now
    await expect(updateSetting(fin, "booking.hold_minutes", "15")).rejects.toBeInstanceOf(AuthError);
    await updateSetting(sup, "booking.hold_minutes", "15");
    expect(await getSetting("booking.hold_minutes")).toBe(15);
    await updateSetting(sup, "payouts.require_admin_approval", "false");
    expect(await getSetting("payouts.require_admin_approval")).toBe(false);
    await expect(updateSetting(sup, "booking.hold_minutes", "abc")).rejects.toBeInstanceOf(DomainError);
    await expect(updateSetting(sup, "payments.refund_fee_policy", "nonsense")).rejects.toBeInstanceOf(DomainError);
    await expect(updateSetting(sup, "not.a.key", "1")).rejects.toBeInstanceOf(DomainError);
    const trail = await auditRows("setting", "booking.hold_minutes");
    expect(trail).toHaveLength(1);
    expect(trail[0].before).toEqual({ value: 20 });
    expect(trail[0].after).toEqual({ value: 15 });
    const listed = await listSettingsWithValues();
    expect(listed.find((s) => s.key === "booking.hold_minutes")).toMatchObject({ value: 15, overridden: true, type: "number" });
    expect(listed.every((s) => s.description.length > 10)).toBe(true);
  });
});

describe("reports", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("creating a report validates the target and notifies moderators and super admins only", async () => {
    const mod = await admin("moderator");
    const sup = await admin("super");
    const fin = await admin("finance");
    const reporter = await createUser({ isStudent: true });
    const target = await createUser({ roles: ["tutor"] });
    await expect(createReport(reporter.id, { targetType: "user", targetId: "00000000-0000-0000-0000-000000000000", reason: "fraud", details: "" })).rejects.toBeInstanceOf(DomainError);
    await expect(createReport(reporter.id, { targetType: "user", targetId: reporter.id, reason: "fraud", details: "" })).rejects.toBeInstanceOf(DomainError);
    const row = await createReport(reporter.id, { targetType: "user", targetId: target.id, reason: "harassment", details: "Sent rude messages" });
    expect((await db.query.reports.findFirst({ where: eq(reports.id, row.id) }))?.status).toBe("open");
    const notes = await db.select().from(notifications).where(eq(notifications.type, "report.new"));
    expect(notes.map((n) => n.userId).sort()).toEqual([mod.id, sup.id].sort());
    expect(notes.some((n) => n.userId === fin.id)).toBe(false);
    expect(notes.every((n) => n.dedupeKey === `report:${row.id}:${n.userId}`)).toBe(true);
  });
});
