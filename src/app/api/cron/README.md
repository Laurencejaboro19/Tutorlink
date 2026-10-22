# Cron jobs

Two routes, scheduled in `vercel.json` (Vercel Hobby allows daily crons):

| Route              | Schedule (UTC) | Run key               | What it does |
| ------------------ | -------------- | --------------------- | ------------ |
| `/api/cron/daily`  | `0 2 * * *`    | `daily:<YYYY-MM-DD>`  | expire booking holds, auto-complete sessions, expire stale payments and subscriptions, expire stale challenge attempts, ensure a leaderboard cycle is open, recompute tutor ranks |
| `/api/cron/cycles` | `30 2 * * *`   | `cycles:<YYYY-MM-DD>` | finalize ended leaderboard cycles, distribute student + tutor rewards for finalized cycles, ensure a cycle is open |

Both go through `runCronJob` (`src/lib/cron.ts`): the request must carry `Authorization: Bearer $CRON_SECRET`
(Vercel adds this automatically when `CRON_SECRET` is set in the project env), and each run key executes
at most once — a repeat call for the same platform day returns `{ ok: true, skipped: true, outcome }`.
The platform day is Africa/Lagos, so "once a day" means once per Lagos calendar day.

## Trigger manually

```bash
# local dev server (CRON_SECRET from .env.local)
curl -sS -H "Authorization: Bearer dev-cron-secret" http://localhost:3100/api/cron/daily | jq
curl -sS -H "Authorization: Bearer dev-cron-secret" http://localhost:3100/api/cron/cycles | jq

# production
curl -sS -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/cycles | jq
```

To force a re-run on the same day (e.g. after fixing data), delete the run row and call again:

```sql
delete from cron_runs where run_key = 'cycles:2026-10-22';
```

Every step inside a job is isolated: a failing step is reported under `outcome.<step>Error` (daily) or
`outcome.errors` (cycles) and the remaining steps still run. Outcomes are stored in `cron_runs.outcome`.
