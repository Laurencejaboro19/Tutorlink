/**
 * Vitest setup (runs before every test file). Loads .env.test (tutorlink_test) via ./env so
 * modules that read env at import time (the db pool) see the test configuration, applies
 * migrations and seeds reference data once, and exposes shared helpers:
 *   createUser({ isStudent | isTutor | adminRole | roles: [...] })   insert a completed-onboarding user
 *   truncateAll()                                                  wipe all non-reference tables
 */
import "./env";
import { afterAll, beforeAll } from "vitest";

const NON_REFERENCE_TABLES = [
  "audit_logs",
  "notifications",
  "reports",
  "rate_limits",
  "cron_runs",
  "webhook_events",
  "tutor_rewards",
  "student_rewards",
  "leaderboard_results",
  "leaderboard_cycles",
  "engagement_events",
  "attempts",
  "questions",
  "challenges",
  "credit_entries",
  "referral_events",
  "referrals",
  "referral_codes",
  "payouts",
  "tutor_bank_accounts",
  "refunds",
  "ledger_entries",
  "payments",
  "reviews",
  "bookings",
  "subscriptions",
  "packages",
  "tutor_availability",
  "tutor_service_areas",
  "tutor_qualifications",
  "tutor_exams",
  "tutor_subjects",
  "tutor_profiles",
  "one_time_tokens",
  "sessions",
  "users",
];

async function getDb() {
  return import("@/db");
}

let prepared = false;
export async function prepareDatabase() {
  if (prepared) return;
  const { db, pool } = await getDb();
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await migrate(db, { migrationsFolder: "./drizzle" });
  const { rows } = await pool.query("select (select count(*) from subscription_plans)::int as plans, (select count(*) from states)::int as states, (select count(*) from subjects)::int as subjects");
  if (Number(rows[0].plans) < 3 || Number(rows[0].states) < 30 || Number(rows[0].subjects) < 1) {
    const { seedReferenceData } = await import("@/db/seed");
    await seedReferenceData();
  }
  prepared = true;
}

export async function truncateAll() {
  const { pool } = await getDb();
  await pool.query(`truncate table ${NON_REFERENCE_TABLES.map((t) => `"${t}"`).join(", ")} restart identity cascade`);
}

type Location = { stateId: number; lgaId: number; cityId: number };
type CreateUserOpts = {
  roles?: ("student" | "tutor")[];
  isStudent?: boolean;
  isTutor?: boolean;
  adminRole?: "super" | "moderator" | "finance" | null;
  name?: string;
  email?: string;
  location?: Location | null;
};

let counter = 0;

/**
 * Inserts a user with completed onboarding (no location unless `location` is given). With `roles: ["tutor"]` a
 * listed, identity-verified tutor profile is created too (the `isTutor` form inserts no
 * profile so tests can shape their own).
 */
export async function createUser(opts: CreateUserOpts = {}) {
  const { db, schema } = await getDb();
  counter++;
  const isStudent = opts.isStudent ?? opts.roles?.includes("student") ?? false;
  const isTutor = opts.isTutor ?? opts.roles?.includes("tutor") ?? false;
  const loc = opts.location ?? null;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: opts.email ?? `user${Date.now()}_${counter}@test.local`,
      phone: `+23480${String(10000000 + counter).padStart(8, "0")}`,
      passwordHash: "x",
      fullName: opts.name ?? `Test User ${counter}`,
      displayName: opts.name?.split(" ")[0] ?? `User${counter}`,
      isStudent,
      isTutor,
      adminRole: opts.adminRole ?? null,
      onboardingStep: "complete",
      emailVerifiedAt: new Date(),
      stateId: loc?.stateId ?? null,
      lgaId: loc?.lgaId ?? null,
      cityId: loc?.cityId ?? null,
    })
    .returning();
  if (opts.roles?.includes("tutor")) {
    await db
      .insert(schema.tutorProfiles)
      .values({ userId: user.id, bio: "Experienced tutor used in automated tests, bio long enough for validation.", offersOnline: true, offersPhysical: true, isListed: true, identityStatus: "verified" })
      .onConflictDoNothing();
  }
  return user;
}

/** First Lagos LGA + its first city: the default location for test users. */
export async function defaultLocation(): Promise<Location> {
  const { pool } = await getDb();
  const { rows } = await pool.query(
    `select s.id as state_id, l.id as lga_id, c.id as city_id from states s join lgas l on l.state_id = s.id join cities c on c.lga_id = l.id where s.name = 'Lagos' order by l.id, c.id limit 1`,
  );
  return { stateId: Number(rows[0].state_id), lgaId: Number(rows[0].lga_id), cityId: Number(rows[0].city_id) };
}

/** A location in another state (Kano) for "outside service area" cases. */
export async function otherLocation(): Promise<Location> {
  const { pool } = await getDb();
  const { rows } = await pool.query(
    `select s.id as state_id, l.id as lga_id, c.id as city_id from states s join lgas l on l.state_id = s.id join cities c on c.lga_id = l.id where s.name = 'Kano' order by l.id, c.id limit 1`,
  );
  return { stateId: Number(rows[0].state_id), lgaId: Number(rows[0].lga_id), cityId: Number(rows[0].city_id) };
}

export async function firstSubjects(n = 2) {
  const { pool } = await getDb();
  const { rows } = await pool.query(`select id from subjects where active order by id limit $1`, [n]);
  return rows.map((r) => Number(r.id));
}

/** `hourLocal:00` Lagos time, `daysAhead` days from today (Lagos is UTC+1, no DST). */
export function futureAt(hourLocal: number, daysAhead = 1) {
  const lagosNow = new Date(Date.now() + 3_600_000);
  const day = new Date(Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate() + daysAhead));
  return new Date(`${day.toISOString().slice(0, 10)}T${String(hourLocal).padStart(2, "0")}:00:00+01:00`);
}

beforeAll(async () => {
  await prepareDatabase();
});

afterAll(async () => {
  const { pool } = await getDb();
  await pool.end().catch(() => {});
});
