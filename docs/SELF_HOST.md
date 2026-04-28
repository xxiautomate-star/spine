# Self-host Spine — env var contract + cutover smoke test

Spine is portable across Supabase projects (Cloud, self-hosted, throwaway,
local-dev). The cutover is a **3-env-var swap + redeploy** — no code change
required.

## The contract

Three environment variables drive every Supabase connection in the app.
Set them in Coolify (production), Vercel (preview), or `.env.local`
(development). Spine never hardcodes the URL or keys in source — they are
read from the environment at runtime (server-side) or inlined at build time
by Next.js (client-side `NEXT_PUBLIC_*`).

| Var | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | server clients · browser client · middleware | Inlined into the client bundle at `next build`. Changing this requires a rebuild for the change to reach the browser. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | server clients · browser client · middleware | Same — inlined at build. Restricted by RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role client only (`@/lib/supabase/service`) | Server-only. Never inlined. Bypasses RLS — guard every route handler. |

Three client modules, one role each:

| Module | Role | Auth |
|---|---|---|
| `@/lib/supabase/server` | server components · route handlers · server actions | cookie-bound (sees the calling user) |
| `@/lib/supabase/browser` | client components | cookie-bound (sees the calling user) |
| `@/lib/supabase/service` | server-side admin work after API-key check | service-role (bypasses RLS) |

The legacy import paths `@/lib/supabase`, `@/lib/supabase-browser`,
`@/lib/supabase-server` are preserved as thin re-exports — old callers do
not need to be updated.

## Cutover procedure

The actual swap is mechanical. Every step is verifiable:

```bash
# 1. Apply the consolidated migration to the new project
psql "$NEW_DATABASE_URL" -f saas/spine/supabase/migrations/_CONSOLIDATED_FRESH_PROJECT.sql

# 2. Set the three env vars in Coolify (or wherever the deployment lives)
NEXT_PUBLIC_SUPABASE_URL=https://db.xxiautomate.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ…NEW…
SUPABASE_SERVICE_ROLE_KEY=eyJ…NEW…

# 3. Trigger a fresh build (Coolify auto-deploys on push; force a rebuild
#    so the NEXT_PUBLIC_* values inline correctly)
git commit --allow-empty -m "chore(spine): trigger rebuild after Supabase swap"
git push origin main

# 4. Smoke test (see paste-block below)
```

## Smoke test paste-block

Run this against a deployed instance after a Supabase swap. Every step
must pass before the cutover is real.

```bash
# Replace with the deployment under test
SPINE=https://spine.xxiautomate.com

# 1. /api/ping — server is up + Supabase URL resolves
curl -s "$SPINE/api/ping" | jq .
# expect: {"ok": true, ...}

# 2. /api/keys/validate without a key — confirms auth path runs
curl -s -X POST "$SPINE/api/keys/validate" -H "Content-Type: application/json" -d '{}'
# expect: 401 with "Missing bearer token"

# 3. Sign up via magic link in a browser
#    Visit $SPINE/login?signup=1 → email → click link → land on /dashboard/keys

# 4. Mint a key
#    Click "Mint key" → copy the spine_live_xxx value

# 5. Capture
SPINE_KEY=spine_live_xxx
curl -s -X POST "$SPINE/api/capture" \
  -H "Authorization: Bearer $SPINE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content":"smoke test memory captured at $(date -u)"}'
# expect: {"id":"...uuid..."} + the embed pipeline runs server-side

# 6. Recall
curl -s -X POST "$SPINE/api/recall" \
  -H "Authorization: Bearer $SPINE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"smoke test","limit":5}'
# expect: memories[] includes the row from step 5

# 7. Timeline
curl -s "$SPINE/api/timeline?limit=10" \
  -H "Authorization: Bearer $SPINE_KEY" | jq '.memories | length'
# expect: ≥ 1

# 8. Forget the smoke memory so the test is idempotent
curl -s -X POST "$SPINE/api/forget" \
  -H "Authorization: Bearer $SPINE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"$MEMORY_ID\"}"
# expect: {"forgotten": true}
```

## Failure modes (and their fingerprints)

| Symptom | Likely cause |
|---|---|
| 503 *"Server not configured"* on every API route | `SUPABASE_SERVICE_ROLE_KEY` not set in deployment |
| 500 *"Auth not configured"* on dashboard pages | `NEXT_PUBLIC_SUPABASE_URL` or `_ANON_KEY` missing at build time |
| 401 *"Unauthorized"* on dashboard, magic-link emails work | Cookies not making it through middleware. Check `middleware.ts` matcher. |
| Magic-link clicked, lands on `/login?error=…` | Supabase project's allowed redirect URLs don't include `https://<deploy>/auth/callback` |
| Recall returns rows from the wrong project | Build was deployed before env vars updated. Force a rebuild — `NEXT_PUBLIC_*` is inlined. |

The last row is the one that bites: changing `NEXT_PUBLIC_SUPABASE_URL`
without rebuilding leaves stale URLs inlined in the browser bundle. The
server side picks up the new URL immediately; the browser still hits the
old one. Always force a rebuild after a `NEXT_PUBLIC_*` env change.

## What's NOT yet portable (deferred)

- **Magic-link sender** — currently relies on Supabase's hosted SMTP. For
  a self-hosted Supabase instance, configure SMTP via Resend (already
  used elsewhere in Spine) or Postmark before cutover.
- **GoTrue OAuth providers** — Spine v2 ships magic-link only. OAuth
  comes back as a Pro-tier feature later.
- **pgvector + pgcrypto extensions** — required at the database level.
  The consolidated migration enables them, but on a fresh project make
  sure the Supabase plan supports them.
