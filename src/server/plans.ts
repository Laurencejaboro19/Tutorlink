import "server-only";
import { and, count, desc, eq, gt, inArray, lte } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { packages, subscriptionPlans, subscriptions } from "@/db/schema";
import { getSetting } from "@/lib/settings";

export type PlanCode = "free" | "premium" | "premium_plus";
export type Plan = typeof subscriptionPlans.$inferSelect;

export async function getPlan(code: PlanCode, tx?: Tx): Promise<Plan> {
  const exec = tx ?? db;
  const row = await exec.query.subscriptionPlans.findFirst({ where: eq(subscriptionPlans.code, code) });
  if (!row) throw new Error(`Plan ${code} not seeded`);
  return row;
}

export async function listPlans() {
  return db.select().from(subscriptionPlans).where(eq(subscriptionPlans.active, true)).orderBy(subscriptionPlans.sortOrder);
}

/**
 * The tutor's current entitlement: the most valuable *active, unexpired* subscription,
 * else Free. Entitlements are read server-side for every pricing/commission/publishing decision.
 */
export async function getActiveSubscription(tutorId: string, tx?: Tx) {
  const exec = tx ?? db;
  const now = new Date();
  const rows = await exec.query.subscriptions.findMany({
    where: and(eq(subscriptions.tutorId, tutorId), eq(subscriptions.status, "active"), lte(subscriptions.startsAt, now), gt(subscriptions.endsAt, now)),
    orderBy: desc(subscriptions.endsAt),
  });
  if (!rows.length) return null;
  const rank: Record<PlanCode, number> = { free: 0, premium: 1, premium_plus: 2 };
  return rows.sort((a, b) => rank[b.planCode] - rank[a.planCode] || b.endsAt.getTime() - a.endsAt.getTime())[0];
}

export async function getActivePlan(tutorId: string, tx?: Tx): Promise<{ plan: Plan; subscription: typeof subscriptions.$inferSelect | null }> {
  const sub = await getActiveSubscription(tutorId, tx);
  const plan = await getPlan(sub?.planCode ?? "free", tx);
  return { plan, subscription: sub };
}

export async function publishedPackageLimit(plan: Plan): Promise<number | null> {
  if (plan.code === "free") return (plan.maxPublishedPackages ?? (await getSetting("plans.free_max_published_packages"))) as number;
  return plan.maxPublishedPackages; // null = unlimited
}

export async function canPublishAnotherPackage(tutorId: string, tx?: Tx): Promise<{ ok: boolean; limit: number | null; published: number }> {
  const exec = tx ?? db;
  const { plan } = await getActivePlan(tutorId, tx);
  const limit = await publishedPackageLimit(plan);
  const [{ n }] = await exec
    .select({ n: count() })
    .from(packages)
    .where(and(eq(packages.tutorId, tutorId), inArray(packages.status, ["published"])));
  return { ok: limit === null || n < limit, limit, published: n };
}
