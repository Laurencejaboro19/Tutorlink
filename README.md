# TutorLink

Location-aware tutoring marketplace for Nigeria: students find verified tutors by **State → LGA → city** (or online), compare packages, book and pay through **Flutterwave**, review completed sessions, take **daily challenges**, climb **leaderboards**, earn **rewards and referral credits**. Tutors manage packages, availability, service areas, bookings, earnings, subscriptions (Free / Premium / Premium+) and their own challenges. Admins verify tutors, moderate, reconcile payments and approve rewards — every sensitive action is audited.

## Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js 16 (App Router), React 19, TypeScript strict** | One deployable: server components for data-heavy pages, server actions for mutations, route handlers for webhooks/cron. Vercel-native. |
| Styling | **Tailwind CSS v4** with brand tokens in `src/app/globals.css` (blue `#024EA2`, teal `#01A09C` taken from the logo) | Consistent, small, no component-library lock-in. |
| Database | **PostgreSQL 16 + Drizzle ORM** (`src/db/schema.ts`), SQL migrations in `/drizzle` | Relational integrity: FKs, unique/idempotency keys, CHECK constraints and a `btree_gist` **EXCLUDE** constraint that makes overlapping tutor bookings impossible at the database level. |
| Auth | Own implementation: argon2id password hashes, DB-backed sessions (httpOnly cookie, hashed token), one-time tokens for email verification/reset, DB-backed rate limiting | No third-party dependency on the critical path; every page/action authorises on the server (`requireUser/requireTutor/requireAdmin`, `assert*`). |
| Payments | **Flutterwave v3** Standard checkout, `/transactions/{id}/verify`, refunds, transfers (payouts, gated) | Server-initiated, server-verified, idempotent webhooks, auditable ledger. |
| Background jobs | **Vercel Cron** → `/api/cron/daily` and `/api/cron/cycles` (secured with `CRON_SECRET`, run-once keys in `cron_runs`) | Holds expire, sessions auto-complete, subscriptions expire, cycles finalize and rewards distribute without anyone opening the app. |
| Tests | **Vitest** against a real PostgreSQL test database | Business rules are tested where they live (services), not mocked away. |

Service boundaries live in `src/server/*.ts` (trusted code only): `payments`, `ledger`, `bookings`, `subscriptions`, `plans`, `credits`, `referrals`, `challenges`, `leaderboards`, `ranking`, `search`, `refunds`, `payouts`, `admin`. UI never computes prices, commissions, scores, balances or eligibility.

See `docs/CONVENTIONS.md` for engineering rules.

## Local setup

```bash
# 1. PostgreSQL (any 14+). Create two databases:
createdb tutorlink && createdb tutorlink_test

# 2. Environment
cp .env.example .env.local        # fill DATABASE_URL, AUTH_SECRET, ADMIN_BOOTSTRAP_EMAIL, Flutterwave TEST keys
#    .env.test is committed and points at tutorlink_test (no secrets)

# 3. Install, migrate, seed reference data (37 states, 774 LGAs, cities, subjects, exams, plans)
npm install
npm run db:migrate
npm run db:seed

# 4. Run
npm run dev          # http://localhost:3000
```

The first account registered with `ADMIN_BOOTSTRAP_EMAIL` becomes a **super admin**. Email verification links are logged to the server console (and shown in the UI outside production) until SMTP or Resend is configured (or while `EMAIL_DEBUG_LINKS=true`).

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Next.js |
| `npm run db:generate` | Create a migration from schema changes (never edit applied migrations) |
| `npm run db:migrate` | Apply migrations (`drizzle/`) |
| `npm run db:seed` | Idempotent reference data (safe on every deploy) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm test` | Vitest integration tests against `tutorlink_test` |
| `npm run check` | typecheck + lint + test |

## Environment variables

See `.env.example`. Required in production: `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, `AUTH_SECRET` (≥32 random bytes), `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_WEBHOOK_HASH`, `CRON_SECRET`, `ADMIN_BOOTSTRAP_EMAIL`. Optional: `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS` (e.g. Gmail App Password) or `RESEND_API_KEY`, plus `EMAIL_FROM` (email delivery); `EMAIL_DEBUG_LINKS=true` shows links on screen during first setup only, `PAYOUTS_ENABLED=true` (only after the go-live checklist), `FLUTTERWAVE_MODE=live`.

## Payments: test mode vs live mode

* **Test mode** — keys contain `_TEST-`. Use Flutterwave's test cards; no money moves. This is the mode for every environment except production.
* **Live mode** — live keys, `FLUTTERWAVE_MODE=live`. Requires an approved Flutterwave merchant account, settlement bank account and a webhook secret hash. Payouts additionally need `PAYOUTS_ENABLED=true` and a funded Flutterwave balance.

Flow: `createPaymentIntent` → `/pay/[id]` asks Flutterwave for a hosted link (`POST /v3/payments`, unique `tx_ref`) → customer pays → Flutterwave redirects to `/payments/callback` **and** posts a webhook to `/api/webhooks/flutterwave`. Both paths call `GET /v3/transactions/{id}/verify` and converge in `applyVerification`, which locks the payment row and applies the result once (status, amount and currency must match). The redirect alone never confirms anything.

### Webhook configuration

Dashboard → Settings → Webhooks → URL `https://<your-domain>/api/webhooks/flutterwave`, secret hash = `FLUTTERWAVE_WEBHOOK_HASH`. Requests without a matching `verif-hash` header get **401**. Events are stored in `webhook_events` with a unique key (`event:id:status`), so duplicates and out-of-order deliveries are harmless; failed processing returns 500 so Flutterwave retries.

## Money model

* All amounts are NGN `numeric(12,2)`; arithmetic is done in kobo as `bigint` (`src/lib/money.ts`).
* `ledger_entries` is append-only. A ₦10,000 booking on the Free plan produces `payment_received +10000`, `processing_fee −fee`, `platform_commission +3000`, `tutor_earning +7000`. Premium: 2000/8000. Premium+: 1000/9000. The commission rate is **snapshotted on the booking** at booking time.
* Refunds post negative `refund` rows against commission and earning (proportional to the refund %) and a `refund` cash row when the provider refund completes. Nothing is ever rewritten.
* Platform **credits** (`credit_entries`) are separate from cash and from tutor earnings; the balance is the sum of `available` entries; redemptions are capped at 50% of a booking (configurable) and reversed automatically if the booking fails.
* Processing fees are absorbed on the platform side of the commission (configurable policy `payments.refund_fee_policy`).

## Business rules you can change without code

`/admin/settings` (super admins) edits `platform_settings`; defaults are in `src/lib/settings.ts`: hold minutes, cancellation windows and refund %, free-plan package limit, referral amounts, credit redemption cap, challenge limits, leaderboard cycle length / top N / reward value / cash eligibility, tutor-reward thresholds, ranking priors, payout minimums.

Plan prices and commission rates are rows in `subscription_plans` (editable in `/admin/subscriptions`).

### Policies that are explicit defaults, not commitments

* Student cancellation ≥24h before start: 100% refund; later: 50%; after start: 0%. Tutor cancellation / tutor no-show: 100% refund and a ranking penalty.
* Upgrades start a new 30-day period immediately (no proration); renewals extend the current period; cancellation keeps benefits until period end; expiry never removes packages.
* Cash reward eligibility = a completed paid session ≥ ₦2,000 within the cycle; everyone else in the top 10 receives credit. Cash rewards are approved by finance and paid by bank transfer; they are never automatic.
* Premium+ tutors receive leaderboard recognition but no further plan reward.

## Tutor ranking (documented model)

`src/server/ranking.ts`: Bayesian rating (prior 4.2 with weight 5 so one 5★ review cannot beat an established tutor) 45%, completion rate 20%, response speed 10%, repeat students 10%, volume 5%, verification 5%, plus a fading 30-day new-tutor boost. Search adds location and subject relevance at query time. Paid plans add a small disclosed boost and results are labelled **Promoted** when a boost is in play.

## Security measures implemented

* Server-side authorisation on every page (layouts) and every server action (`assert*`), ownership re-checked against the database; admin roles `super | moderator | finance` with separate powers.
* argon2id hashes; sessions stored hashed; password reset revokes all sessions; login/registration/reset rate-limited per IP in Postgres.
* Prices, commissions, credit usage, scores and reward eligibility are computed only on the server; correct answers are never sent to the client before submission.
* Idempotency keys on ledger, credits, referral milestones, rewards, webhook events, cron runs; `FOR UPDATE` row locks around state transitions; DB CHECK + EXCLUDE constraints.
* Secrets never reach the browser; bank account numbers are AES-256-GCM encrypted; identity document references are visible only to moderators/super admins.
* Security headers (HSTS, nosniff, frame deny, referrer policy), `robots.txt` blocks private areas, soft-delete with data minimisation for NDPA.

## Deployment (Vercel)

1. Create a Postgres database (Neon via Vercel Marketplace, Supabase, or any managed Postgres) and copy its connection string.
2. Import the GitHub repo into Vercel. Build uses `vercel-build` (migrate → seed → `next build`), so `DATABASE_URL` must be set **before the first deploy**.
3. Add the environment variables above (Production + Preview). Set `NEXT_PUBLIC_APP_URL` to the production URL.
4. Deploy. Cron jobs come from `vercel.json`. Verify `https://<domain>/api/health` returns `{ ok: true }`.
5. Configure the Flutterwave webhook (above) and register your admin account with `ADMIN_BOOTSTRAP_EMAIL`.

### Backups and recovery

Use the database provider's point-in-time recovery / daily snapshots (Neon and Supabase include this). The application holds no state outside PostgreSQL. To restore: restore the database snapshot, redeploy the same commit, re-run `npm run db:seed` (idempotent).

### External accounts required

* GitHub (source), Vercel (hosting + cron), PostgreSQL provider, Flutterwave merchant account (test keys for staging, live keys + webhook hash for production), optional Resend (email).

## Status: implemented · tested · production-ready?

See the delivery report in the pull request / project notes for the per-feature matrix. In short: the marketplace, bookings, payment verification, ledger, subscriptions, referrals, challenges, leaderboards, rewards and admin console are implemented with automated tests; **live** payments and payouts require Flutterwave merchant approval and a production review of the policies above before launch.
