# TutorLink engineering conventions (read before adding code)

Stack: Next.js 16 App Router (src/app), React 19, TypeScript strict, Tailwind v4 (tokens in src/app/globals.css),
Drizzle ORM + node-postgres (src/db/schema.ts is the single source of truth), zod 4, vitest.
Next 16 notes: `params`/`searchParams` are Promises (`await`). Use `PageProps<"/route">` / `RouteContext<"/api/x/[id]">` generated types.
`proxy.ts` replaces middleware (we do NOT use it; auth is enforced in layouts/actions). No `cacheComponents`.

## Where things live
- `src/db/schema.ts`           tables + enums. Add columns only via `npm run db:generate` (new migration in /drizzle). Never edit old migrations.
- `src/server/*.ts`            trusted domain services (`import "server-only"`). Business rules live here and ONLY here.
- `src/server/*-actions.ts`    `"use server"` files. Export ONLY async functions. Parse FormData with `parseForm(schema, formData)`,
                               authorise with `assertUser/assertRole/assertAdmin`, call services, return `ActionResult` (`succeed/fail/toActionError`).
- `src/app/**`                 pages (server components by default) + small `*-client.tsx`/`*-form.tsx` client components.
- `src/components/ui.tsx`      Button, ButtonLink, Field, Input, Select, Textarea, Checkbox, Card, CardHeader, PageHeader, Badge, Alert,
                               EmptyState, Skeleton, Stat, Pagination, Avatar, Logo, StarRating. `src/components/action-form.tsx`: ActionForm, FieldError, SubmitButton.
- `src/lib/*`                  money (NGN strings + kobo bigint), settings (getSetting), time (Africa/Lagos helpers), notify, audit, rate-limit, result, validation.

## Rules
1. Money: `numeric` columns are strings. Use `toKobo/fromKobo/percentOf/addNgn/subNgn/compareNgn/formatNgn`. Never `Number()` for arithmetic.
2. Authorisation is server-side in every page (`requireStudent/requireTutor/requireAdmin` in layouts already) AND every action (`assert*`). Never trust ids/prices/roles from the client — re-load the row and check ownership.
3. Every financial or reward write goes through the services (`payments.ts`, `ledger.ts`, `credits.ts`, `bookings.ts`, `subscriptions.ts`, `referrals.ts`) with idempotency keys. Do not insert into ledger/credit tables directly from actions.
4. Mutations inside `db.transaction(async (tx) => …)`; pass `tx` to `audit()`/`notify()`. Lock rows with `.for("update")` before state transitions.
5. Validation with zod; show field errors with `<FieldError name=…/>`. Every button/form must do something real.
6. Pagination: `limit/offset` with `Pagination` component; never load whole tables. Use indexes that exist (see schema).
7. Never select `questions.correctKey` into anything that reaches the client before an attempt is submitted.
8. Tailwind: use tokens (`text-ink-700`, `bg-brand-600`, `text-teal-600`, `tl-card`, `tl-input`, `tl-table`). Mobile-first, 44px touch targets, labels on all inputs, status = text + badge (never colour only).
9. Status enums come from `src/db/schema.ts`; render with `Badge` and a human label helper in the module.
10. After adding routes run `npx next typegen && npx tsc --noEmit && npx eslint src --max-warnings=0`. Keep the build green.
11. Dev server: `PORT=3100 npx next dev` (already running on :3100 in this environment — do not start another). DB: local Postgres via `.env.local`. Tests: `npm test` uses `.env.test` → `tutorlink_test`.
12. Do not create demo users/payments in migrations or seeds. Demo data lives only in `scripts/demo-data.ts` (clearly labelled).
