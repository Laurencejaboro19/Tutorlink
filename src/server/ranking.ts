import "server-only";
import { and, avg, count, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { bookings, reviews, tutorProfiles } from "@/db/schema";
import { getSettings } from "@/lib/settings";

/**
 * Performance-based tutor ranking (documented, configurable).
 *
 * rank_score ∈ [0, ~1.3] =
 *   0.45 · bayesian_rating/5         Bayesian average: (prior_w·prior + n·avg)/(prior_w + n)
 * + 0.20 · completion_rate           completed / (completed + tutor cancellations + tutor no-shows)
 * + 0.10 · response_speed            1 if median first response ≤ 1h, decays to 0 at 48h
 * + 0.10 · repeat_students           min(1, repeat_students / 5)
 * + 0.05 · engagement                min(1, completed_sessions / 20)
 * + 0.05 · verification              identity verified (+0.5) and qualifications verified (+0.5)
 * + new_tutor_boost                  +0.15 for the first 30 days (so new tutors get exposure), fading linearly
 *
 * Search then adds *location relevance* and *subject relevance* at query time (not stored),
 * and paid plans add a small disclosed visibility boost that is shown as "Promoted" when it
 * changes the order. A single 5★ review cannot outrank an established tutor because of the prior.
 */
export async function recomputeTutorRank(tutorId: string, tx?: Tx) {
  const exec = tx ?? db;
  const s = await getSettings(["ranking.bayesian_prior_rating", "ranking.bayesian_prior_weight", "ranking.new_tutor_boost_days", "ranking.new_tutor_boost"]);
  const profile = await exec.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, tutorId) });
  if (!profile) return;

  const [rev] = await exec
    .select({ n: count(), avg: avg(reviews.rating) })
    .from(reviews)
    .where(and(eq(reviews.tutorId, tutorId), eq(reviews.status, "published")));
  const n = rev?.n ?? 0;
  const avgRating = Number(rev?.avg ?? 0);
  const bayes = (s["ranking.bayesian_prior_weight"] * s["ranking.bayesian_prior_rating"] + n * avgRating) / (s["ranking.bayesian_prior_weight"] + n);

  const [stats] = await exec
    .select({
      completed: sql<number>`count(*) filter (where ${bookings.status} = 'completed')`,
      badTutor: sql<number>`count(*) filter (where ${bookings.status} in ('cancelled_by_tutor','no_show_tutor'))`,
      medianResponseSec: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${bookings.tutorFirstResponseAt} - ${bookings.createdAt}))) filter (where ${bookings.tutorFirstResponseAt} is not null)`,
    })
    .from(bookings)
    .where(eq(bookings.tutorId, tutorId));
  const completed = Number(stats?.completed ?? 0);
  const bad = Number(stats?.badTutor ?? 0);
  const completionRate = completed + bad === 0 ? 0.8 : completed / (completed + bad);

  // repeat students = students with ≥2 completed sessions
  const [repeat] = await exec
    .select({ n: sql<number>`count(*)` })
    .from(sql`(select student_id from bookings where tutor_id = ${tutorId} and status = 'completed' group by student_id having count(*) > 1) r`);
  const repeatStudents = Number(repeat?.n ?? 0);

  const med = stats?.medianResponseSec == null ? null : Number(stats.medianResponseSec);
  const responseSpeed = med == null ? 0.5 : med <= 3600 ? 1 : Math.max(0, 1 - (med - 3600) / (47 * 3600));

  const verification = (profile.identityStatus === "verified" ? 0.5 : 0) + (profile.qualificationStatus === "verified" ? 0.5 : 0);
  const ageDays = (Date.now() - profile.createdAt.getTime()) / 86_400_000;
  const newBoost = ageDays < s["ranking.new_tutor_boost_days"] ? s["ranking.new_tutor_boost"] * (1 - ageDays / s["ranking.new_tutor_boost_days"]) : 0;

  const score = 0.45 * (bayes / 5) + 0.2 * completionRate + 0.1 * responseSpeed + 0.1 * Math.min(1, repeatStudents / 5) + 0.05 * Math.min(1, completed / 20) + 0.05 * verification + newBoost;

  await exec
    .update(tutorProfiles)
    .set({
      ratingAvg: avgRating.toFixed(2),
      ratingCount: n,
      completedSessions: completed,
      repeatStudents,
      avgResponseSeconds: med == null ? null : Math.round(med),
      rankScore: score.toFixed(4),
      rankUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tutorProfiles.userId, tutorId));
  return score;
}

export async function recomputeAllRanks() {
  const ids = await db.select({ id: tutorProfiles.userId }).from(tutorProfiles);
  for (const { id } of ids) await recomputeTutorRank(id);
  return ids.length;
}
