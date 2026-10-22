import "server-only";
import { inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { lgas, states, subjects, tutorServiceAreas, tutorSubjects } from "@/db/schema";
import type { Ngn } from "@/lib/money";

/**
 * Tutor discovery.
 *
 * One SQL query (plus a COUNT) over listed tutors that have ≥1 published package matching the
 * filters. Ordering for "recommended":
 *   score = rank_score                         (performance; see server/ranking.ts)
 *         + location_relevance                 (0.15 same city, 0.10 same LGA, 0.05 same state)
 *         + subject_relevance                  (0.10 when the tutor lists the requested subject)
 *         + plan visibility_boost              (disclosed; result is labelled "Promoted")
 * Location relevance uses the tutor's own location AND their service areas, so an online tutor
 * in the same state still ranks a little higher than one far away.
 */

export const SORTS = ["recommended", "rating", "price_asc", "price_desc", "newest"] as const;
export type SearchSort = (typeof SORTS)[number];
export type SearchFormat = "physical" | "online" | "any";

export type SearchParams = {
  subject?: number;
  level?: string;
  exam?: number;
  format?: SearchFormat;
  state?: number;
  lga?: number;
  city?: number;
  minPrice?: Ngn;
  maxPrice?: Ngn;
  minRating?: number;
  verified?: boolean;
  available?: number; // weekday 0–6
  sort?: SearchSort;
  page?: number;
  pageSize?: number;
};

export type TutorSearchResult = {
  id: string;
  name: string;
  avatarUrl: string | null;
  headline: string | null;
  ratingAvg: number;
  ratingCount: number;
  identityVerified: boolean;
  qualificationsVerified: boolean;
  offersPhysical: boolean;
  offersOnline: boolean;
  minPrice: Ngn | null;
  planCode: "free" | "premium" | "premium_plus";
  boost: number;
  organicScore: number;
  score: number;
  promoted: boolean;
  subjects: { id: number; name: string }[];
  subjectCount: number;
  areas: string[];
  areaCount: number;
};

export const DEFAULT_PAGE_SIZE = 12;
const LEVELS = new Set(["primary", "junior_secondary", "senior_secondary", "tertiary", "adult"]);

function packageFilters(p: SearchParams): SQL {
  const parts: SQL[] = [sql`p.status = 'published'`];
  if (p.subject) parts.push(sql`p.subject_id = ${p.subject}`);
  if (p.level && LEVELS.has(p.level)) parts.push(sql`p.level = ${p.level}::academic_level`);
  if (p.exam) parts.push(sql`p.exam_id = ${p.exam}`);
  if (p.format === "physical") parts.push(sql`p.format in ('physical','hybrid')`);
  if (p.format === "online") parts.push(sql`p.format in ('online','hybrid')`);
  if (p.minPrice) parts.push(sql`p.price_ngn >= ${p.minPrice}::numeric`);
  if (p.maxPrice) parts.push(sql`p.price_ngn <= ${p.maxPrice}::numeric`);
  return sql.join(parts, sql` and `);
}

function tutorFilters(p: SearchParams): SQL {
  const parts: SQL[] = [sql`tp.is_listed = true`, sql`u.status = 'active'`, sql`u.deleted_at is null`];
  parts.push(sql`exists (select 1 from packages p where p.tutor_id = tp.user_id and ${packageFilters(p)})`);
  if (p.verified) parts.push(sql`tp.identity_status = 'verified'`);
  if (p.minRating && p.minRating > 0) parts.push(sql`tp.rating_avg >= ${p.minRating} and tp.rating_count > 0`);
  if (p.available !== undefined && p.available >= 0 && p.available <= 6) {
    const fmt = p.format === "physical" ? sql` and (a.format = 'hybrid' or a.format = 'physical')` : p.format === "online" ? sql` and (a.format = 'hybrid' or a.format = 'online')` : sql``;
    parts.push(sql`exists (select 1 from tutor_availability a where a.tutor_id = tp.user_id and a.weekday = ${p.available}${fmt})`);
  }
  if (p.format === "physical") {
    parts.push(sql`tp.offers_physical = true`);
    if (p.lga) {
      const city = p.city ? sql` and (sa.city_id is null or sa.city_id = ${p.city})` : sql``;
      parts.push(sql`exists (select 1 from tutor_service_areas sa where sa.tutor_id = tp.user_id and sa.lga_id = ${p.lga}${city})`);
    } else if (p.state) {
      parts.push(sql`exists (select 1 from tutor_service_areas sa where sa.tutor_id = tp.user_id and sa.state_id = ${p.state})`);
    }
  } else if (p.format === "online") {
    parts.push(sql`tp.offers_online = true`);
  } else if (p.state) {
    // "any" format: in-person reach in the state OR online availability
    parts.push(sql`(tp.offers_online = true or exists (select 1 from tutor_service_areas sa where sa.tutor_id = tp.user_id and sa.state_id = ${p.state}))`);
  }
  return sql.join(parts, sql` and `);
}

function relevance(p: SearchParams): SQL {
  const terms: SQL[] = [];
  if (p.city) terms.push(sql`case when u.city_id = ${p.city} or exists (select 1 from tutor_service_areas sa where sa.tutor_id = tp.user_id and sa.city_id = ${p.city}) then 0.15 else 0 end`);
  if (p.lga) terms.push(sql`case when u.lga_id = ${p.lga} or exists (select 1 from tutor_service_areas sa where sa.tutor_id = tp.user_id and sa.lga_id = ${p.lga}) then 0.10 else 0 end`);
  if (p.state) terms.push(sql`case when u.state_id = ${p.state} or exists (select 1 from tutor_service_areas sa where sa.tutor_id = tp.user_id and sa.state_id = ${p.state}) then 0.05 else 0 end`);
  if (p.subject) terms.push(sql`case when exists (select 1 from tutor_subjects ts where ts.tutor_id = tp.user_id and ts.subject_id = ${p.subject}) then 0.10 else 0 end`);
  if (!terms.length) return sql`0`;
  return sql.join(terms, sql` + `);
}

type Row = {
  id: string;
  name: string;
  avatar_url: string | null;
  headline: string | null;
  rating_avg: string;
  rating_count: number;
  identity_status: string;
  qualification_status: string;
  offers_physical: boolean;
  offers_online: boolean;
  min_price: string | null;
  plan_code: "free" | "premium" | "premium_plus" | null;
  boost: string;
  organic: string;
  score: string;
};

export async function searchTutors(p: SearchParams) {
  const pageSize = p.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, p.page ?? 1);
  const offset = (page - 1) * pageSize;
  const where = tutorFilters(p);
  const pkgWhere = packageFilters(p);

  const orderBy: Record<SearchSort, SQL> = {
    recommended: sql`score desc, tp.rating_avg desc, tp.rating_count desc, tp.created_at desc`,
    rating: sql`tp.rating_avg desc, tp.rating_count desc, score desc`,
    price_asc: sql`min_price asc nulls last, score desc`,
    price_desc: sql`min_price desc nulls last, score desc`,
    newest: sql`tp.created_at desc, score desc`,
  };
  const sort = p.sort && SORTS.includes(p.sort) ? p.sort : "recommended";

  const rowsQuery = sql`
    select
      tp.user_id as id,
      coalesce(u.display_name, split_part(u.full_name, ' ', 1)) as name,
      u.avatar_url,
      tp.headline,
      tp.rating_avg,
      tp.rating_count,
      tp.identity_status,
      tp.qualification_status,
      tp.offers_physical,
      tp.offers_online,
      (select min(p.price_ngn) from packages p where p.tutor_id = tp.user_id and ${pkgWhere}) as min_price,
      pl.plan_code,
      coalesce(pl.boost, 0) as boost,
      (tp.rank_score + ${relevance(p)}) as organic,
      (tp.rank_score + ${relevance(p)} + coalesce(pl.boost, 0)) as score
    from tutor_profiles tp
    join users u on u.id = tp.user_id
    left join lateral (
      select s.plan_code, sp.visibility_boost as boost
      from subscriptions s join subscription_plans sp on sp.code = s.plan_code
      where s.tutor_id = tp.user_id and s.status = 'active' and s.starts_at <= now() and s.ends_at > now()
      order by sp.sort_order desc, s.ends_at desc limit 1
    ) pl on true
    where ${where}
    order by ${orderBy[sort]}
    limit ${pageSize} offset ${offset}`;

  const countQuery = sql`select count(*)::int as n from tutor_profiles tp join users u on u.id = tp.user_id where ${where}`;

  const [rowsRes, countRes] = await Promise.all([db.execute(rowsQuery), db.execute(countQuery)]);
  const rows = rowsRes.rows as unknown as Row[];
  const total = Number((countRes.rows[0] as { n: number } | undefined)?.n ?? 0);
  const ids = rows.map((r) => r.id);

  const [subjectRows, areaRows] = ids.length
    ? await Promise.all([
        db
          .select({ tutorId: tutorSubjects.tutorId, id: subjects.id, name: subjects.name })
          .from(tutorSubjects)
          .innerJoin(subjects, sql`${subjects.id} = ${tutorSubjects.subjectId}`)
          .where(inArray(tutorSubjects.tutorId, ids))
          .orderBy(subjects.name),
        db
          .select({ tutorId: tutorServiceAreas.tutorId, lga: lgas.name, state: states.name })
          .from(tutorServiceAreas)
          .innerJoin(lgas, sql`${lgas.id} = ${tutorServiceAreas.lgaId}`)
          .innerJoin(states, sql`${states.id} = ${tutorServiceAreas.stateId}`)
          .where(inArray(tutorServiceAreas.tutorId, ids))
          .orderBy(states.name, lgas.name),
      ])
    : [[], []];

  const items: TutorSearchResult[] = rows.map((r) => {
    const subj = subjectRows.filter((s) => s.tutorId === r.id);
    // Put the requested subject first so it is visible in the top-3.
    if (p.subject) subj.sort((a, b) => (a.id === p.subject ? -1 : b.id === p.subject ? 1 : 0));
    const areaList = areaRows.filter((a) => a.tutorId === r.id);
    const uniqueLgas = Array.from(new Set(areaList.map((a) => `${a.lga}, ${a.state}`)));
    const boost = Number(r.boost);
    const planCode = r.plan_code ?? "free";
    return {
      id: r.id,
      name: r.name,
      avatarUrl: r.avatar_url,
      headline: r.headline,
      ratingAvg: Number(r.rating_avg),
      ratingCount: Number(r.rating_count),
      identityVerified: r.identity_status === "verified",
      qualificationsVerified: r.qualification_status === "verified",
      offersPhysical: r.offers_physical,
      offersOnline: r.offers_online,
      minPrice: r.min_price,
      planCode,
      boost,
      organicScore: Number(r.organic),
      score: Number(r.score),
      promoted: boost > 0 && planCode !== "free",
      subjects: subj.slice(0, 3).map((s) => ({ id: s.id, name: s.name })),
      subjectCount: subj.length,
      areas: uniqueLgas.slice(0, 2),
      areaCount: uniqueLgas.length,
    };
  });

  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)), sort };
}

/** Parse raw URL searchParams into SearchParams (lenient: invalid values are dropped). */
export function parseSearchParams(sp: Record<string, string | string[] | undefined>): SearchParams {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : Array.isArray(sp[k]) ? String(sp[k]![0] ?? "").trim() : "");
  const int = (k: string) => {
    const v = one(k);
    return /^\d{1,9}$/.test(v) ? Number(v) : undefined;
  };
  const money = (k: string) => {
    const v = one(k).replace(/[,₦\s]/g, "");
    return /^\d{1,7}(\.\d{1,2})?$/.test(v) ? v : undefined;
  };
  const format = one("format");
  const sort = one("sort");
  const level = one("level");
  const rating = one("minRating");
  const available = one("available");
  return {
    subject: int("subject"),
    level: LEVELS.has(level) ? level : undefined,
    exam: int("exam"),
    format: format === "physical" || format === "online" ? format : "any",
    state: int("state"),
    lga: int("lga"),
    city: int("city"),
    minPrice: money("minPrice"),
    maxPrice: money("maxPrice"),
    minRating: /^[1-5]$/.test(rating) ? Number(rating) : undefined,
    verified: one("verified") === "1" || one("verified") === "on",
    available: /^[0-6]$/.test(available) ? Number(available) : undefined,
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as SearchSort) : "recommended",
    page: int("page") ?? 1,
  };
}
