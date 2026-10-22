import "server-only";
import { db, type Tx } from "@/db";
import { notifications } from "@/db/schema";

/**
 * In-app notification. dedupeKey makes retries/webhook replays safe.
 * Email/SMS fan-out is intentionally not claimed here; see lib/email.ts.
 */
export async function notify(
  n: { userId: string; type: string; title: string; body: string; href?: string; dedupeKey?: string },
  tx?: Tx,
) {
  const exec = tx ?? db;
  await exec
    .insert(notifications)
    .values({ ...n, delivery: "in_app", deliveredAt: new Date() })
    .onConflictDoNothing({ target: notifications.dedupeKey });
}
