# Cron jobs — schedule these or product features go quiet

Spine has five scheduled jobs. They are exposed as `POST` routes guarded by a
shared `CRON_SECRET` bearer token. **The routes exist; nothing calls them by
default.** You have to point an external scheduler at each one. If you skip
this step, the homepage's "weekly digest" / "memory decay" / "morning
briefing" promises become marketing claims with nothing behind them.

## Setup once

1. Set `CRON_SECRET` in Coolify env vars to a long random string (≥32 chars).
2. Redeploy so the env var lands.
3. Pick one scheduler — Coolify scheduled tasks, GitHub Actions, or any
   external HTTP cron service (cron-job.org, EasyCron, etc.). Coolify is the
   path of least resistance because the secret already lives there.
4. Add the five jobs below. **All POST. All bearer-auth.** Body is empty.

## The five jobs

| Job | URL | When | What it does | Marketing it backs up |
|---|---|---|---|---|
| Daily digest | `POST /api/cron/daily-digest` | Daily, 08:00 UTC | Per-user "what your AI captured yesterday" email | "Daily digest" hint on landing page |
| Morning briefing | `POST /api/cron/morning-briefing` | Weekdays, 07:30 UTC | Slack/email briefing of recent decisions and conflicts | "Morning briefing" tier feature |
| Weekly inbox | `POST /api/cron/weekly-inbox` | Mondays, 08:00 UTC | Cross-AI activity summary email | "Weekly inbox" — Pro feature |
| Weekly retention | `POST /api/cron/weekly-retention` | Mondays, 08:00 UTC | Memory decay + revive flow + retention digest | "Weekly retention digest" — Pro feature |
| Retrain weights | `POST /api/cron/retrain-weights` | Nightly, 03:00 UTC | Logistic regression over recall labels → new active weights | "Learned ranker" — internal infra |

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

## Coolify scheduled task example

In Coolify → Resources → spine → Scheduled tasks → Add task:

```
Name:     weekly-retention
Schedule: 0 8 * * 1
Command:  curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://spine.xxiautomate.com/api/cron/weekly-retention
```

Repeat for each of the five jobs with their respective schedules.

## Acceptance check post-launch

After scheduling, on the first Monday after deploy:

- [ ] `weekly-retention` ran (check `/api/digest/[date]` for that user)
- [ ] An email landed in your inbox (Resend dashboard shows the send)
- [ ] No 401s in the cron job logs

If any cron silently fails, the product *appears* to be working but
silently breaks one of its written promises. Treat scheduling as part of the
deploy, not an afterthought.
