# Spine — Manual Security Review

**Date:** 2026-05-07
**Reviewer:** Claude Code (manual audit, no LLM calls)
**Scope:** `saas/spine/` — Next.js 15 App Router + Supabase (pgvector) + MCP server + Stripe.
**Threat model:** Pre-launch SaaS with paying customers. Critical assets: user memories (text + embeddings), API keys (hashed), Stripe billing state, Supabase service-role key.

---

## Quick Wins (5 fixes, each <30 min, close the riskiest gaps)

1. **Fix Stripe webhook column mismatch** — webhook upserts `profiles.id = userId` but the table PK is `user_id`. Paid plan upgrades silently no-op. *(File: `app/api/stripe/webhook/route.ts:52,71`. See P0-1.)*
2. **Make all cron routes fail-closed if `CRON_SECRET` missing** — 4 of 6 cron routes use `if (secret) { ...check... }`, meaning an unset env var skips auth entirely. Change to `if (!secret || auth !== bearer) return 401`. *(See P0-2.)*
3. **Tighten engine `.gitignore`** — engine and root gitignore should both list `.env*` (not just `.env*.local` and bare `.env`). Currently `.env.production` would be tracked if anyone created it. *(See P4-1.)*
4. **Add a 1-line `validate` rate limit on `/api/keys/validate`** — MCP polls this every 6h but a leaked key probe loop has no throttle. Wrap with the existing `rate-limit.ts` keyed by client IP. *(File: `app/api/keys/validate/route.ts`.)*
5. **Block private IPs / non-https in any future SSRF surface in Spine** — Spine itself doesn't accept user URLs server-side today (good), but the pattern needs to live in shared helper before someone adds it. Engine `reference-inject` already has the right pattern; copy it to a `lib/ssrf-guard.ts`.

---

## P0 — Auth & Data Exposure

### P0-1. Stripe webhook column mismatch — paid upgrades silently fail
- **File:** `saas/spine/app/api/stripe/webhook/route.ts:52, 71`
- **What:** Webhook calls `supabase.from('profiles').upsert({ id: userId, plan, memory_cap: ... }, { onConflict: 'id' })`.
- **Why it's wrong:** Schema (`supabase/schema.sql:92-97`) defines `profiles.user_id uuid primary key`. There is **no `id` column** on `profiles` and **no `memory_cap` column either**. The upsert either:
  - Fails entirely (wrong onConflict target), OR
  - Inserts an orphaned row using `id` as a column name that may not exist (depending on Supabase auto-error vs auto-create behavior).
- **Result:** Paying customers' `profiles.plan` never gets bumped to `pro`/`team`. Their key keeps returning `plan: 'free'` from `/api/keys/validate`, so the MCP keeps enforcing the 200-memory cap. They paid; they got nothing.
- **Severity:** P0 (revenue-loss + customer-trust).
- **Fix:** Change to `.upsert({ user_id: userId, plan, plan_updated_at: now }, { onConflict: 'user_id' })`. Drop `memory_cap` (not in schema; cap is computed from plan via `lib/plan-limits.ts`).
- **Bonus catch:** `customer.subscription.deleted` handler has the same bug.

### P0-2. Cron routes fail-OPEN if CRON_SECRET unset
- **Files:**
  - `app/api/cron/daily-digest/route.ts:14-20` — `if (secret) { ...check... }` (open if secret unset)
  - `app/api/cron/weekly-inbox/route.ts:13-19` — same pattern
  - `app/api/cron/key-receipts-prune/route.ts:18-23` — same
  - `app/api/cron/benchmarks/route.ts:17-22` — same
- **What's right (for contrast):**
  - `cron/morning-briefing/route.ts:14-18` and `cron/weekly-retention/route.ts:15-19` use `if (!secret || auth !== ...)` — fail-closed.
  - `cron/retrain-weights/route.ts:107-112` also fail-closed.
- **Why it matters:** If `CRON_SECRET` is ever rotated incorrectly, accidentally cleared in Vercel, or missing in a new env, the 4 listed routes become public. Daily-digest sends emails (cost + reputation), benchmarks run heavy embeddings (cost), key-receipts-prune mutates DB (data integrity).
- **Severity:** P0 — config drift turns auth off silently.
- **Fix:** Change all four to fail-closed, matching the morning-briefing pattern:
  ```ts
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  ```

---

## P1 — Tenant scoping, RLS, abuse surface

### P1-1. `/api/recall` filtered-matches BM25 path is correctly user-scoped — no issue, just noting
- **File:** `app/api/recall/route.ts:55-63` — `fetchFilteredMatches` correctly does `.eq('user_id', userId)` before BM25. The comment on line 51 explicitly calls out the service-role bypass and adds defence-in-depth. Good practice.

### P1-2. `/api/ask` — relies on `spine_match_memories` RPC for tenant scoping, with defence-in-depth
- **File:** `app/api/ask/route.ts:377-422`
- **Note:** The vector search happens via `spine_match_memories(p_user, ...)` RPC — tenant scoping happens server-side in the function. Then the metadata fetch on line 408-412 explicitly re-applies `.eq('user_id', userId)` + `.is('deleted_at', null)`. Defence-in-depth working as intended; flagged here so it stays that way.
- **Risk if changed:** If the RPC ever stops scoping by user (schema change, performance "optimization"), the metadata refetch is the only thing keeping cross-tenant data out. Keep it.
- **Action:** Add a SQL comment to `spine_match_memories` definition warning future maintainers not to remove the user filter.

### P1-3. `/api/memories/export` — service-role client + correct user filter, but no rate limit
- **File:** `app/api/memories/export/route.ts:22-89`
- **What:** Streams up to entire memory corpus. Filters by `.eq('user_id', user.id)`. Auth: `getServerUser()` (cookie-based, correct).
- **Risk:** A compromised session cookie can dump the entire user corpus (text + optionally 1536-dim embeddings) in a single GET. No rate limit, no audit log row, no email confirmation.
- **Severity:** P1 — for power users with months of memory, this is the single most damaging exfil endpoint.
- **Fix:** (a) Add rate limit (1/min, 5/hour). (b) Log an `audit_log` row when export runs with `op='export'`. (c) Optional: email the user when an export larger than N rows happens, like GitHub does for large repo zip downloads.

### P1-4. `/api/keys/validate` — no rate limit on a public endpoint
- **File:** `app/api/keys/validate/route.ts:30-108`
- **What:** Public GET that takes a Bearer token and returns `{ valid, plan, cap, userId, expiresAt }`.
- **Risk:** A leaked or guessed key can be probed without backoff. The `userId` in the 200 response is also useful to an attacker (binds key → user). No `if (recently_failed_for_this_ip)` throttle.
- **Severity:** P1.
- **Fix:** Wrap with the existing `lib/rate-limit.ts` keyed by IP. 60 req/min is plenty for legit MCP polls (MCP polls every 6h).

### P1-5. CORS `Access-Control-Allow-Origin: *` on Bearer-authed routes — acceptable but document
- **File:** `lib/cors.ts:7-14`
- **Why this is OK (per the comment in the file):** Bearer-token auth is NOT cookie-based, so wildcard CORS doesn't open a CSRF surface. A malicious origin can't auto-replay the user's cookie because there's no cookie.
- **Why I'm flagging anyway:** If you ever add a route that accepts cookies (e.g., session-authed alongside the Bearer routes), wildcard CORS becomes dangerous. Either:
  - Put a clear "DO NOT USE FOR COOKIE-AUTHED ROUTES" note above `withCors`, OR
  - Enforce that `withCors` only attaches when the route is Bearer-authed (e.g., separate `withBearerCors` helper).
- **Severity:** P1 (advisory only, not exploitable today).

---

## P2 — Stripe & billing

### P2-1. Stripe webhook signature verification — done correctly
- **File:** `app/api/stripe/webhook/route.ts:16-30`
- **Status:** ✅ Uses `stripe.webhooks.constructEvent(rawBody, sig, secret)` — the canonical Stripe library signature check.
- **No action needed.** Just noting that this part is right (and the column-name bug in P0-1 is downstream of correctly-validated events).

### P2-2. Plan-tier enforcement happens server-side — done correctly
- **File:** `app/api/capture/route.ts:265-298`
- **Status:** ✅ Plan cap is enforced via `auth.authed.plan` (which comes from the server-side DB lookup in `requireApiKey`), against `captureCap()` in `lib/plan-limits.ts`. There is no client-trustworthy `plan` field on the request.
- **No action needed.**

### P2-3. Checkout success URL accepts query string injection? — no, hardcoded. Good.
- **File:** `app/api/stripe/checkout/route.ts:46-47` — `success_url: ${base}/dashboard?upgraded=1`, `cancel_url: ${base}/pricing`. Both built from `publicBaseUrl()`, not from user input. Good.

---

## P3 — Dependency CVEs

### P3-1. Spine root — `npm audit` summary
**Total: 10 vulnerabilities (1 critical, 9 moderate)**

| Package | Severity | Issue | Fix Path |
|---|---|---|---|
| `next` (root) | **critical** (mostly low/moderate CVEs aggregated to "critical" by npm) | Multiple Next.js advisories: GHSA-3h52-269p-cp9r (origin verification dev server), GHSA-67rr-84xm-4c7r (cache-poisoning DoS), GHSA-g5qg-72qw-gw5v (image-opt cache key confusion), GHSA-xv57-4mr9-wg8v (image content injection), GHSA-4342-x723-ch2f (middleware SSRF), GHSA-9qr9-h5gf-34mp (RCE in React flight protocol), GHSA-w37m-7fhw-fmv9 (Server Actions source exposure), GHSA-mwv6-3258-q52c (RSC DoS), GHSA-9g9p-9gw9-jx7f (image optimizer DoS), GHSA-h25m-26qc-wcjf (HTTP request deserialization DoS), GHSA-f82v-jwr5-mffw (auth bypass in middleware), GHSA-ggv3-7p47-pfv8 (request smuggling in rewrites), GHSA-3x4c-7xq6-9pq8 (image disk-cache exhaust), GHSA-q4gf-8mx6-v5v3 (Server Components DoS) | `npm audit fix` (within current major). The auth-bypass (GHSA-f82v-jwr5-mffw) is the one that matters most — make sure post-fix Next is ≥15.4.7 or whatever the patched line is. |
| `postcss` | moderate | XSS via unescaped `</style>` in stringify | `npm audit fix` |
| `esbuild` | moderate | Dev-server can be queried by any website (GHSA-67mh-4wv8-2f99) | `npm audit fix --force` (semver-major) — but only affects local `npm run dev`, not production. Acceptable for now. |
| `hono` (transitive) | moderate | bodyLimit bypass; JSX HTML injection | `npm audit fix` |
| `ip-address` | moderate | XSS in Address6 HTML methods | Transitive, fixed by upgrading `express-rate-limit` |
| `express-rate-limit` | moderate | Depends on vulnerable `ip-address` | `npm audit fix` |
| `@vitest/mocker` | moderate | Via vite | dev-only; defer |

**Action:** Run `npm audit fix` (no breaking changes). The Next.js auth-bypass (GHSA-f82v-jwr5-mffw) is the only one that's actively exploitable in production routing.

### P3-2. Spine MCP package — `npm audit` summary
**Total: 3 moderate.**
- `hono` (bodyLimit + JSX injection) — `npm audit fix`
- `ip-address` + `express-rate-limit` (transitive XSS) — `npm audit fix`

**Action:** `cd packages/mcp && npm audit fix`.

---

## P4 — Secret hygiene

### P4-1. `.gitignore` covers `.env*.local` and `.env`, but not `.env.production`/`.env.staging`
- **File:** `saas/spine/.gitignore:8-9`
- **Current:**
  ```
  .env
  .env*.local
  ```
- **Gap:** A future `.env.production` or `.env.staging` would NOT match either glob. (Root-level `.gitignore` does not currently fix this; it only has `.env`.)
- **Severity:** P4 (defense-in-depth; nothing leaked today).
- **Fix:** Change to:
  ```
  .env
  .env.*
  !.env.example
  !.env.local.example
  ```

### P4-2. No committed secrets detected
- Searched git history + working tree for `sk-`, `npm_`, `AIza`, `pat_`, `SUPABASE_SERVICE_ROLE_KEY=ey`. Only matches were:
  - `docs/GO_LIVE.md` — placeholder `SUPABASE_SERVICE_ROLE_KEY=eyJ...` (not a real key, just an instructional placeholder).
- Verified `git ls-files` shows no `.env*` files committed at any path.

### P4-3. `screenshots/` folder is gitignored — good
- `.gitignore:26` — `screenshots/store/` excluded. Confirmed.

---

## P5 — Other observations (lower priority but worth noting)

### P5-1. `requireApiKey` defensively handles orphaned keys with null user_id (good)
- **File:** `lib/auth.ts:54-61`
- Already covered with a comment + early reject. Keep this pattern when adding new key-related routes.

### P5-2. `checkout/route.ts` — `customer_email: user.email` from session, not body — good
- **File:** `app/api/stripe/checkout/route.ts:43-48`
- Email is taken from authenticated user, not request body. Prevents a user from creating a Stripe checkout against another email.

### P5-3. Service-role key never reaches the browser
- `lib/supabase/service.ts:60` — `getSupabase()` is called only from server routes. `lib/supabase/server.ts` uses the anon key + cookie auth. Confirmed clean.

### P5-4. `team/[id]/invite` and `team/[id]/join` — not yet reviewed in depth
- These were out of immediate P0 scope. Recommend a follow-up audit specifically on the team-invite flow before launching the Team plan, since invite tokens + role assignment are a classic auth-bypass surface.

---

## Acceptable for Current Threat Model

- **CORS wildcard on Bearer-authed routes** — fine because no cookie auth surface.
- **Embedding-vector "injection"** — a malicious user can put arbitrary text in their own embedding rows, but those are scoped to their own user_id; no cross-tenant impact.
- **Service-role client used in capture/recall** — RLS bypass is intentional and necessary for the bearer-auth model. All 12 routes I checked correctly re-apply `.eq('user_id', auth.userId)` server-side.
- **No `dangerouslySetInnerHTML` use anywhere in spine app code.** Confirmed via grep.
- **No raw SQL template strings.** All queries go through the Supabase query builder or parameterised `.rpc(...)` calls. SQL injection surface = effectively zero.

---

## Suggested follow-ups (not findings, just hardening ideas)

1. Wire `lib/audit.ts` into `/api/keys/[id]` DELETE so revoked keys leave a trail.
2. Add a CI job that runs `npm audit --audit-level=high` and fails the build on new HIGH+ findings.
3. Document the "service-role-client + manual user_id filter" pattern in `docs/SECURITY.md` so future contributors don't bypass it.
4. Consider rotating `SUPABASE_SERVICE_ROLE_KEY` quarterly. The key is the single largest blast radius in the system.
