import "server-only";
import { db, type Tx } from "@/db";
import { auditLogs } from "@/db/schema";

export async function audit(
  entry: {
    actorId: string | null;
    actorRole?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
  },
  tx?: Tx,
) {
  const exec = tx ?? db;
  await exec.insert(auditLogs).values({
    actorId: entry.actorId,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    before: (entry.before ?? null) as object | null,
    after: (entry.after ?? null) as object | null,
    ip: entry.ip ?? null,
  });
}
