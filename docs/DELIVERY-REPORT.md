# TutorLink — delivery report (milestone 1, October 2026)

## 1. Architecture and technologies

Next.js 16 (App Router, React 19, TypeScript strict) · Tailwind CSS v4 with brand tokens from the TutorLink logo · PostgreSQL 16 + Drizzle ORM with SQL migrations · own argon2id/session auth · Flutterwave v3 (Standard checkout, verify, refund, transfer) · Vercel Cron for scheduled work · Vitest integration tests on a real Postgres. Rationale in `README.md`.

## 2. Modules implemented

| Module | Key files |
| --- | --- |
| Identity & onboarding | `src/lib/auth.ts`, `src/server/auth-actions.ts`, `onboarding-actions.ts`, `/register /login /verify-email /forgot-password /reset-password /onboarding /account` |
| Nigeria locations | `src/db/seed-data/*` (37 states, 774 LGAs, 1,056 cities), `/api/locations`, `LocationPicker` |
| Tutor profiles, verification, packages, availability, service areas | `src/server/tutor-profile*.ts`, `packages.ts`, `availability*.ts`, `/tutor/profile /tutor/packages /tutor/availability` |
| Discovery & ranking | `src/server/search.ts`, `ranking.ts`, `/tutors`, `/tutors/[id]` |
| Bookings & reviews | `src/server/bookings.ts`, `booking-queries.ts`, `booking-actions.ts`, `/book/[packageId]`, `/dashboard/bookings`, `/tutor/bookings` |
| Payments, ledger, refunds, payouts | `src/server/payments.ts`, `ledger.ts`, `refunds.ts`, `payouts.ts`, `flutterwave.ts`, `/pay/[id]`, `/payments/callback`, `/api/webhooks/flutterwave`, `/receipts/[id]`, `/tutor/earnings`, `/dashboard/payments` |
| Subscriptions & commissions | `src/server/plans.ts`, `subscriptions.ts`, `/tutor/subscription`, `/pricing` |
| Referrals & credits | `src/server/referrals.ts`, `credits.ts`, `/dashboard/referrals`, `/tutor/referrals`, `/dashboard/credits` |
| Daily challenges | `src/server/challenges.ts`, `challenge-actions.ts`, `/challenges`, `/challenges/[id]`, `/tutor/challenges` |
| Leaderboards & rewards | `src/server/leaderboards.ts`, `/leaderboard`, `/leaderboard/history`, `/how-rewards-work` |
| Notifications & reports | `src/lib/notify.ts`, `/notifications`, `/report` |
| Administration & audit | `src/server/admin.ts`, `admin-actions.ts`, `/admin/*` (13 sections) |
| Background jobs | `/api/cron/daily`, `/api/cron/cycles`, `vercel.json`, `src/lib/cron.ts` |

## 3. Database

47 tables / 31 enums in `src/db/schema.ts`; migrations `drizzle/0000_init.sql` (schema) and `drizzle/0001_constraints.sql` (btree_gist EXCLUDE on overlapping active bookings, CHECKs on money, ratings, availability windows). Unique idempotency keys on ledger, credits, referral events, rewards, webhook events, subscriptions (promotional grants) and cron runs.

## 4. Functional workflows completed (end-to-end, verified in the browser)

Register → verify email → location → role → profile → workspace · tutor profile/qualification/identity submission → admin review → listing toggle · package create/publish within plan limits · availability + service areas · search with filters and promoted labelling · booking with slot generation, credit redemption, hold, payment intent → `/pay` → verified callback/webhook → confirmed → acknowledge → meeting link → complete → review · cancellation with refund quote → refund request → finance approve/execute · subscription purchase → verified → commission change · referral code → signup → milestones → credits · challenge create → review → publish → attempt → grading → results · leaderboard live standings → cycle finalize → rewards (cash pending review / credit issued) → tutor promotional month · admin: users, tutors, bookings/disputes, payments/reconciliation, refunds, payouts, subscriptions/plans, challenges, referrals, rewards, reports, settings, audit.

## 5. Automated tests (actual results)

`npm test` → **5 files, 55 tests, all passing** (bookings 11, search 5, payments 11, growth 16, admin 12). They run against `tutorlink_test` on PostgreSQL 16 and cover: role permissions and cross-user access, both-role accounts, location/subject/format filtering and pagination, free/premium/premium+ commission (3000/2000/1000 on ₦10,000), duplicate and concurrent booking prevention (EXCLUDE constraint), cancellation quotes, completion rules, review-once, payment verification success/failure/amount mismatch, duplicate and invalid webhooks (401), subscription activation/expiry, refunds success/failure, payout gating, referral milestones (once only, self/flagged rejected, five-session milestone), answer validation and scoring, hidden answer keys, duplicate submissions, attempt limits, tie-breaking, idempotent finalization, cash-vs-credit classification, budget cap, duplicate reward prevention, promotional subscription duration, settings persistence, admin role enforcement.

`npm run typecheck`, `npm run lint` (`--max-warnings=0`) and `npm run build` are clean.

## 6. Security measures implemented

Server-side authorisation in layouts and actions with re-loaded ownership checks; admin roles super/moderator/finance enforced in the service layer; argon2id; hashed DB sessions; rate limiting (register, login, reset, reports, attempts); server-only prices/commissions/scores/eligibility; answer keys never serialised pre-submit; idempotency keys + row locks + DB constraints; AES-256-GCM for bank account numbers; identity document references visible to moderators only; security headers; soft delete with data minimisation; webhook hash check + provider re-verification; cron secret; payouts double-gated (`PAYOUTS_ENABLED` + admin approval).

## 7. External integrations configured

* Flutterwave v3 — implemented (initialize, verify by id/reference, refund, transfer, webhook) and unit-tested with mocks; **not exercised against the live provider from this environment** (no merchant keys available here).
* Resend email — implemented behind `RESEND_API_KEY`; when unset, verification links are logged and shown outside production.
* Vercel Cron — configured in `vercel.json`.

## 8. Integrations still requiring credentials or approval

| Item | Needed |
| --- | --- |
| Flutterwave test keys + webhook hash | `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_WEBHOOK_HASH` → run one sandbox checkout and one webhook delivery to confirm end-to-end |
| Flutterwave live mode | Approved merchant, settlement account, `FLUTTERWAVE_MODE=live`, live keys |
| Payouts (transfers) | Funded balance + `PAYOUTS_ENABLED=true` + finance approval policy |
| Email delivery | Resend account + verified sending domain |
| Student cash rewards | Finance process for collecting winners' bank details (currently recorded by an admin at approval) |

## 9–10. Commands

Run: `npm install && npm run db:migrate && npm run db:seed && npm run dev`. Test/build: `npm run check` (typecheck + lint + tests), `npm run build`, `npm start`. Vercel uses `vercel-build` (migrate → seed → build).

## 11. Remaining work before production launch

1. Flutterwave sandbox end-to-end run on the deployed URL (checkout, callback, webhook, refund).
2. Product-owner sign-off on configurable policies (cancellation windows and refund %, credit cap, reward budget/eligibility, tutor-reward thresholds, free-plan package limit) via `/admin/settings`.
3. File uploads for identity/qualification documents (currently reference text; needs an object store such as Vercel Blob or S3 with private access).
4. Transfer webhooks (`transfer.completed/failed`) to auto-close payouts; today finance marks them completed/failed.
5. Email/SMS notification fan-out for the most important events once a provider is configured.
6. Legal review of Terms/Privacy for NDPA; safeguarding policy for sessions involving minors.
7. Load test search and leaderboard queries with realistic data; add read replicas/caching only if needed.

## 12. Exact next steps

1. Create the GitHub repo and Vercel project (in progress), attach a Neon Postgres, set env vars, deploy, hit `/api/health`.
2. Register the admin account (`ADMIN_BOOTSTRAP_EMAIL`), create a tutor account, run through the booking flow with Flutterwave test keys.
3. Configure the Flutterwave webhook URL and secret hash; confirm a `charge.completed` event is stored in `webhook_events` with outcome `successful`.
4. Review `/admin/settings` and plan rows; then invite real tutors.

### Status matrix

| Feature | Implemented | Tested (automated) | Production-ready |
| --- | --- | --- | --- |
| Auth, onboarding, roles | ✔ | ✔ | ✔ (email delivery pending provider) |
| Locations, profiles, verification | ✔ | ✔ | ✔ (document uploads pending) |
| Search & ranking | ✔ | ✔ | ✔ |
| Bookings, cancellations, reviews | ✔ | ✔ | ✔ |
| Payments & ledger | ✔ | ✔ (mocked provider) | after sandbox run |
| Subscriptions & commissions | ✔ | ✔ | after sandbox run |
| Refunds / payouts | ✔ | ✔ (mocked) | after sandbox run + payout policy |
| Referrals & credits | ✔ | ✔ | ✔ |
| Challenges | ✔ | ✔ | ✔ |
| Leaderboards & rewards | ✔ | ✔ | after finance process for cash |
| Admin console & audit | ✔ | ✔ | ✔ |
| Cron jobs | ✔ | manual | ✔ on Vercel |
