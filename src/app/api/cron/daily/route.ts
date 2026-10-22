import { runCronJob } from "@/lib/cron";
import { platformDay } from "@/lib/time";
import { autoCompleteSessions, expireHolds } from "@/server/bookings";
import { expireStaleAttempts } from "@/server/challenges";
import { ensureOpenCycle } from "@/server/leaderboards";
import { expireStalePayments } from "@/server/payments";
import { recomputeAllRanks } from "@/server/ranking";
import { expireSubscriptions } from "@/server/subscriptions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily housekeeping (Vercel Cron, 02:00 UTC = 03:00 Lagos). Runs once per platform day;
 * a second call on the same day returns the recorded outcome. Each step is isolated so one
 * failure does not block the rest; failed steps are reported in the outcome.
 */
export async function GET(req: Request) {
  return runCronJob(req, "daily", `daily:${platformDay()}`, async () => {
    const outcome: Record<string, number | string> = {};
    const steps: [string, () => Promise<number | string>][] = [
      ["expiredHolds", expireHolds],
      ["autoCompletedSessions", autoCompleteSessions],
      ["expiredPayments", () => expireStalePayments()],
      ["expiredSubscriptions", expireSubscriptions],
      ["expiredAttempts", () => expireStaleAttempts()],
      ["cycle", async () => (await ensureOpenCycle()).id],
      ["ranksRecomputed", recomputeAllRanks],
    ];
    for (const [key, fn] of steps) {
      try {
        outcome[key] = await fn();
      } catch (e) {
        outcome[`${key}Error`] = e instanceof Error ? e.message : String(e);
      }
    }
    return outcome;
  });
}
