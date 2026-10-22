/**
 * DEMO DATA — marketplace & bookings. Never run in tests or production.
 *
 *   set -a; . ./.env.local; set +a; npx tsx --require ./scripts/server-only-shim.cjs scripts/demo-marketplace.ts
 *
 * Creates three listed demo tutors (Lagos / Edo / online-only) with subjects, availability,
 * service areas and published packages via the same services the app uses, so /tutors,
 * /tutors/[id] and /book/[packageId] can be checked by hand. Idempotent: re-running skips
 * tutors whose demo email already exists. Password for all demo tutors: Passw0rd123.
 */
import { and, eq } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { db, pool } from "../src/db";
import { cities, lgas, states, subjects, tutorProfiles, users } from "../src/db/schema";
import { addAvailabilityWindow, addServiceArea } from "../src/server/availability";
import { createPackage, publishPackage } from "../src/server/packages";
import { recomputeTutorRank } from "../src/server/ranking";
import { updateTutorProfile } from "../src/server/tutor-profile";

if (process.env.NODE_ENV === "production" || /_test\b/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to seed demo data into production or the test database.");
  process.exit(1);
}

async function loc(stateName: string, lgaName: string, cityName?: string) {
  const [s] = await db.select().from(states).where(eq(states.name, stateName));
  if (!s) throw new Error(`state ${stateName} missing — run npm run db:seed`);
  const [l] = await db.select().from(lgas).where(and(eq(lgas.stateId, s.id), eq(lgas.name, lgaName)));
  if (!l) throw new Error(`lga ${lgaName} missing`);
  let c: { id: number } | undefined;
  if (cityName) [c] = await db.select().from(cities).where(and(eq(cities.lgaId, l.id), eq(cities.name, cityName)));
  if (!c) [c] = await db.select().from(cities).where(eq(cities.lgaId, l.id)).limit(1);
  return { stateId: s.id, lgaId: l.id, cityId: c?.id ?? null };
}

async function subjectIds(slugs: string[]) {
  const rows = await db.select().from(subjects);
  const out: number[] = [];
  for (const slug of slugs) {
    const r = rows.find((x) => x.slug === slug) ?? rows.find((x) => x.name.toLowerCase().includes(slug));
    if (r) out.push(r.id);
  }
  if (!out.length) out.push(rows[0].id);
  return out;
}

type Demo = {
  email: string;
  fullName: string;
  displayName: string;
  headline: string;
  bio: string;
  years: number;
  home: { state: string; lga: string; city?: string };
  physical: boolean;
  online: boolean;
  subjects: string[];
  areas: { state: string; lga: string; city?: string }[];
  windows: { weekday: number; startMinute: number; endMinute: number }[];
  packages: { title: string; description: string; subject: string; level: "primary" | "junior_secondary" | "senior_secondary" | "tertiary" | "adult"; format: "physical" | "online" | "hybrid"; price: string; duration: number; sessions: number; outcomes: string[] }[];
};

const DEMOS: Demo[] = [
  {
    email: "demo.tutor.lagos@tutorlink.local",
    fullName: "Adaeze Okafor (DEMO)",
    displayName: "Adaeze",
    headline: "WAEC & JAMB Mathematics coach — 8 years, 90% credit pass rate",
    bio: "DEMO tutor. I teach Mathematics and Further Mathematics for WAEC, NECO and JAMB with a past-question-first method. Sessions are structured: 10 minutes of recap, 35 minutes of guided problem solving, and a timed drill. Parents get a short progress note after each session.",
    years: 8,
    home: { state: "Lagos", lga: "Ikeja", city: "Maryland" },
    physical: true,
    online: true,
    subjects: ["mathematics", "further-mathematics", "physics"],
    areas: [
      { state: "Lagos", lga: "Ikeja" },
      { state: "Lagos", lga: "Kosofe", city: "Ogudu" },
      { state: "Lagos", lga: "Somolu" },
    ],
    windows: [1, 2, 3, 4, 5].flatMap((d) => [{ weekday: d, startMinute: 16 * 60, endMinute: 20 * 60 }]).concat([{ weekday: 6, startMinute: 9 * 60, endMinute: 15 * 60 }]),
    packages: [
      { title: "WAEC Mathematics crash course (4 sessions)", description: "Four 90-minute sessions covering the ten most-tested WAEC Mathematics topics with timed past-question drills after every lesson. Includes a diagnostic test and a personalised revision plan.", subject: "mathematics", level: "senior_secondary", format: "hybrid", price: "24000", duration: 90, sessions: 4, outcomes: ["Solve WAEC past questions under time pressure", "Master algebra, indices and logarithms", "Confident with trigonometry and mensuration", "Personal revision timetable"] },
      { title: "JAMB Physics one-to-one session", description: "A focused 60-minute online session on any JAMB Physics topic you choose. Bring your questions; we work through them and finish with a 10-question quiz you keep.", subject: "physics", level: "senior_secondary", format: "online", price: "4500", duration: 60, sessions: 1, outcomes: ["Topic clarity in one sitting", "Exam-style practice questions"] },
    ],
  },
  {
    email: "demo.tutor.benin@tutorlink.local",
    fullName: "Osaze Igbinedion (DEMO)",
    displayName: "Osaze",
    headline: "Chemistry & Biology tutor in Benin City — UNIBEN graduate",
    bio: "DEMO tutor. Chemistry graduate offering in-person lessons across Oredo and Egor LGAs and online sessions nationwide. I specialise in SS2–SS3 Chemistry and Biology, with practical demonstrations where possible, and I prepare students for WAEC and Post-UTME.",
    years: 4,
    home: { state: "Edo", lga: "Oredo", city: "Benin City" },
    physical: true,
    online: true,
    subjects: ["chemistry", "biology"],
    areas: [
      { state: "Edo", lga: "Oredo" },
      { state: "Edo", lga: "Egor" },
    ],
    windows: [0, 2, 4].map((d) => ({ weekday: d, startMinute: 10 * 60, endMinute: 18 * 60 })),
    packages: [
      { title: "SS3 Chemistry: organic chemistry mastery", description: "Three 60-minute sessions on alkanes to esters: naming, reactions and the exam questions that trip students up every year. Worksheets provided after each session with marked feedback.", subject: "chemistry", level: "senior_secondary", format: "hybrid", price: "12000", duration: 60, sessions: 3, outcomes: ["Name and draw organic compounds confidently", "Predict reaction products", "Score full marks on organic questions"] },
    ],
  },
  {
    email: "demo.tutor.online@tutorlink.local",
    fullName: "Fatima Bello (DEMO)",
    displayName: "Fatima",
    headline: "English Language & Literature online — IELTS 8.5, 6 years teaching",
    bio: "DEMO tutor. I teach English Language, Literature-in-English and IELTS preparation fully online. Lessons use live documents so you leave every session with corrected writing. Suitable for JSS to adult learners; evening and weekend slots available.",
    years: 6,
    home: { state: "Kano", lga: "Nasarawa" },
    physical: false,
    online: true,
    subjects: ["english", "literature"],
    areas: [],
    windows: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, startMinute: 18 * 60, endMinute: 22 * 60 })),
    packages: [
      { title: "Essay writing for WAEC English (2 sessions)", description: "Two online sessions on argumentative and narrative essays: planning, paragraphing and the marking scheme examiners actually use. You write one essay between sessions and get line-by-line feedback.", subject: "english", level: "senior_secondary", format: "online", price: "7000", duration: 60, sessions: 2, outcomes: ["Plan an essay in five minutes", "Write to the WAEC marking scheme", "Fix recurring grammar errors"] },
      { title: "IELTS speaking practice", description: "A 45-minute mock speaking test with scored feedback on fluency, vocabulary, grammar and pronunciation, plus a plan for the next week of practice.", subject: "english", level: "adult", format: "online", price: "5000", duration: 45, sessions: 1, outcomes: ["Know your current band", "Targeted practice plan"] },
    ],
  },
];

async function main() {
  const passwordHash = await hash("Passw0rd123", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  for (const d of DEMOS) {
    const existing = await db.query.users.findFirst({ where: eq(users.email, d.email) });
    if (existing) {
      console.log(`skip ${d.email} (exists) → /tutors/${existing.id}`);
      continue;
    }
    const home = await loc(d.home.state, d.home.lga, d.home.city);
    const [u] = await db
      .insert(users)
      .values({ email: d.email, phone: "+2348012345678", passwordHash, fullName: d.fullName, displayName: d.displayName, isStudent: false, isTutor: true, onboardingStep: "complete", emailVerifiedAt: new Date(), stateId: home.stateId, lgaId: home.lgaId, cityId: home.cityId })
      .returning();
    await db.insert(tutorProfiles).values({ userId: u.id, identityStatus: "verified", qualificationStatus: "verified" });
    const ids = await subjectIds(d.subjects);
    await updateTutorProfile(u.id, { headline: d.headline, bio: d.bio, yearsExperience: d.years, offersPhysical: d.physical, offersOnline: d.online, subjectIds: ids, levels: ["junior_secondary", "senior_secondary", "adult"], examIds: [] });
    for (const w of d.windows) await addAvailabilityWindow(u.id, { ...w, format: "hybrid" });
    for (const a of d.areas) {
      const l = await loc(a.state, a.lga, a.city);
      await addServiceArea(u.id, { stateId: l.stateId, lgaId: l.lgaId, cityId: a.city ? l.cityId : null });
    }
    for (const p of d.packages) {
      const [subjectId] = await subjectIds([p.subject]);
      const pkg = await createPackage(u.id, { title: p.title, description: p.description, subjectId: ids.includes(subjectId) ? subjectId : ids[0], level: p.level, examId: null, format: p.format, priceNgn: `${p.price}.00`, durationMinutes: p.duration, sessionsCount: p.sessions, outcomes: p.outcomes, requirements: null });
      await publishPackage(u.id, pkg.id);
      console.log(`  package ${pkg.title} → /book/${pkg.id}`);
    }
    await db.update(tutorProfiles).set({ isListed: true }).where(eq(tutorProfiles.userId, u.id));
    await recomputeTutorRank(u.id);
    console.log(`created ${d.email} → /tutors/${u.id}`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
