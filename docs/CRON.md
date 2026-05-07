# Cron jobs — schedule these or product features go quiet

Spine has six scheduled jobs. They are exposed as `POST` routes guarded by a
shared `CRON_SECRET` bearer token. **Vercel cron** drives them via the
`crons` array in `vercel.json` at the repo root of this app. If a cron is
missing from `vercel.json`, the homepage's "weekly digest" / "memory decay" /
"morning briefing" promises become marketing claims with nothing behind them,
and `/proof` keeps falling back to the calibration baseline forever.

## Setup once

1. Set `CRON_SECRET` in Vercel project env vars (Production scope) to a long
   random string (≥32 chars).
2. Set `HARNESS_API_KEY` in Vercel project env vars (Production scope) —
   value is a Spine API key minted from the dashboard. Without it the
   benchmarks job returns 500.
3. Confirm the `crons` array in `saas/spine/vercel.json` matches your plan.
   The file in this repo is the source of truth and currently lists the
   Hobby-tier subset (`benchmarks` + `weekly-retention`).
4. Redeploy so the env vars and `vercel.json` land. **Vercel cron auto-fires
   the routes on the schedule** — no other scheduler needed. Vercel signs the
   request with the `CRON_SECRET` automatically when the route checks
   `Authorization: Bearer $CRON_SECRET`.

> Plan note: Vercel Hobby allows 2 daily crons. The full six-cron set
> requires Pro. The repo ships the Hobby subset by default; the four
> deferred crons (`daily-digest`, `morning-briefing`, `weekly-inbox`,
> `retrain-weights`) can be run manually via `curl` until you upgrade.

## The six jobs

| Job | URL | When | What it does | Marketing it backs up |
|---|---|---|---|---|
| Daily digest | `POST /api/cron/daily-digest` | Daily, 08:00 UTC | Per-user "what your AI captured yesterday" email | "Daily digest" hint on landing page |
| Morning briefing | `POST /api/cron/morning-briefing` | Weekdays, 07:30 UTC | Slack/email briefing of recent decisions and conflicts | "Morning briefing" tier feature |
| Weekly inbox | `POST /api/cron/weekly-inbox` | Mondays, 08:00 UTC | Cross-AI activity summary email | "Weekly inbox" — Pro feature |
| Weekly retention | `POST /api/cron/weekly-retention` | Mondays, 08:00 UTC | Memory decay + revive flow + retention digest | "Weekly retention digest" — Pro feature |
| Retrain weights | `POST /api/cron/retrain-weights` | Nightly, 03:00 UTC | Logistic regression over recall labels → new active weights | "Learned ranker" — internal infra |
| Benchmarks | `POST /api/cron/benchmarks` | Nightly, 02:00 UTC | Runs the recall-quality eval (50 themed queries + 5 false-positive) and writes one row to `benchmark_runs`. `/proof` reads the latest row | "We measured. Here's what we got." (proof page headline) |

## Curl pattern (verify each manually before scheduling)

```bash
curl -X POST https://spine.xxiautomate.com/api/cron/weekly-retention \
  -H "Authorization: Bearer $CRON_SECRET"
# expect: {"ok":true,...}
```

If you get `401 Unauthorized` → secret mismatch.
If you get `503 Server not configured.` → Supabase env vars missing.
If you get a 5-minute timeout → user base is large enough that the job needs
splitting; talk to me.

## vercel.json — current schedule

The live file in this repo (`saas/spine/vercel.json`) ships the Hobby-tier
subset — two daily crons, the maximum Vercel Hobby allows:

```json
{
  "crons": [
    { "path": "/api/cron/benchmarks",       "schedule": "0 2 * * *" },
    { "path": "/api/cron/weekly-retention", "schedule": "0 8 * * 1" }
  ]
}
```

When Spine moves to Vercel Pro, expand to the full set — these are the
remaining four, in priority order:

```json
{ "path": "/api/cron/daily-digest",     "schedule": "0 8 * * *" },
{ "path": "/api/cron/morning-briefing", "schedule": "30 7 * * 1-5" },
{ "path": "/api/cron/weekly-inbox",     "schedule": "0 8 * * 1" },
{ "path": "/api/cron/retrain-weights",  "schedule": "0 3 * * *" }
```

Vercel hits each `path` with `GET` (the platform default) — but our routes
originally exported only `POST`. Each cron route additionally exports a `GET`
shim that delegates to `POST` (`vercel.json` doesn't accept a method override).
If a new cron route is added, mirror that pattern.

## Acceptance check for the benchmarks job specifically

The `/proof` page reads from `benchmark_runs`. Until a real row lands there,
the page renders "Calibration baseline (cron not yet wired)". To make it
disappear:

1. Confirm migration `028_benchmark_runs.sql` is applied to the live Supabase.
2. Confirm `HARNESS_API_KEY` env var is set and is a valid Spine API key.
3. Run the benchmarks cron once manually (`curl -X POST ...`) — it should
   return `{"ok":true,"runId":"...","result":{...}}` within ~30s.
4. Hit `/proof` — the strapline now reads `Run at <timestamp>` instead of
   `Calibration baseline`.
5. Schedule weekly in Coolify per the recipe above. After the next Sunday
   02:00 UTC firing, a second row lands and the sparkline gets its first
   real comparison point.

## Acceptance check post-launch

After scheduling, on the first Monday after deploy:

- [ ] `weekly-retention` ran (check `/api/digest/[date]` for that user)
- [ ] An email landed in your inbox (Resend dashboard shows the send)
- [ ] No 401s in the cron job logs

If any cron silently fails, the product *appears* to be working but
silently breaks one of its written promises. Treat scheduling as part of the
deploy, not an afterthought.
