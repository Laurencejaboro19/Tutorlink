import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { leaderboardCycles } from "@/db/schema";
import { runCronJob } from "@/lib/cron";
import { platformDay } from "@/lib/time";
import { distributeRewards, ensureOpenCycle, finalizeCycle } from "@/server/leaderboards";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Leaderboard cycle maintenance (Vercel Cron, 02:30 UTC, after the daily job).
 * 1. Finalize every open cycle whose end has passed (freezes standings per scope).
 * 2. Distribute rewards for every finalized-but-unrewarded cycle (students + tutors).
 * 3. Make sure a cycle covers "now".
 * All three steps are idempotent, so re-running on another day is safe.
 */
export async function GET(req: Request) {
  return runCronJob(req, "cycles", `cycles:${platformDay()}`, async () => {
    const now = new Date();
    const finalized: { id: string; inserted: number; scopes: number }[] = [];
    const errors: Record<string, string> = {};
    const ended = await db.select({ id: leaderboardCycles.id }).from(leaderboardCycles).where(and(eq(leaderboardCycles.status, "open"), lte(leaderboardCycles.endsAt, now)));
    for (const c of ended) {
      try {
        const r = await finalizeCycle(c.id, now);
        finalized.push({ id: c.id, inserted: r.inserted, scopes: r.scopes });
      } catch (e) {
        errors[`finalize:${c.id}`] = e instanceof Error ? e.message : String(e);
      }
    }
    const rewarded: { id: string; cash: number; credit: number; rejected: number; tutorRewards: number }[] = [];
    const pending = await db.select({ id: leaderboardCycles.id }).from(leaderboardCycles).where(eq(leaderboardCycles.status, "finalized"));
    for (const c of pending) {
      try {
        const r = await distributeRewards(c.id);
        rewarded.push({ id: c.id, cash: r.cash, credit: r.credit, rejected: r.rejected, tutorRewards: r.tutorRewards });
      } catch (e) {
        errors[`rewards:${c.id}`] = e instanceof Error ? e.message : String(e);
      }
    }
    const current = await ensureOpenCycle(now);
    return { finalized, rewarded, currentCycle: current.id, currentCycleEndsAt: current.endsAt.toISOString(), errors };
  });
}
