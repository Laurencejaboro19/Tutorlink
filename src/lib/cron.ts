import "server-only";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { cronRuns } from "@/db/schema";
import { safeEqual } from "./auth";

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Manual runs may use the same header. */
export function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  return Boolean(secret) && safeEqual(header, `Bearer ${secret}`);
}

/**
 * Runs a job at most once per `runKey` (e.g. "finalize-cycle:2026-10"); concurrent or
 * repeated invocations for the same key return the recorded outcome instead of re-running.
 */
export async function runCronJob(req: Request, job: string, runKey: string, fn: () => Promise<unknown>) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [row] = await db.insert(cronRuns).values({ job, runKey }).onConflictDoNothing({ target: cronRuns.runKey }).returning();
  if (!row) {
    const existing = await db.query.cronRuns.findFirst({ where: eq(cronRuns.runKey, runKey) });
    return NextResponse.json({ ok: true, skipped: true, outcome: existing?.outcome ?? null });
  }
  try {
    const outcome = await fn();
    await db.update(cronRuns).set({ finishedAt: new Date(), outcome: (outcome ?? {}) as object }).where(eq(cronRuns.id, row.id));
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(cronRuns).set({ finishedAt: new Date(), error: msg }).where(eq(cronRuns.id, row.id));
    console.error(`[cron:${job}]`, e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
