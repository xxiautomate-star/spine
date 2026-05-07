# Spine — auth + Stripe smoke recipes

Hand-runnable end-to-end checks for the two friction points the launch
audit can't verify from the worker session (each needs a real fresh
account, a real magic-link inbox, or a real Stripe test card). Run these
on Roman's laptop after deploying.

---

## A1 — Sign-up → API key → first capture

### Code path (verified by reading)

1. `/login` → `LoginClient` calls
   `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: callback } })`.
2. Supabase emails a magic link.
3. User clicks → hits `/auth/callback?code=…&next=…`.
4. Callback exchanges the code for a session via
   `supabase.auth.exchangeCodeForSession`. Default `next=/dashboard/keys`.
5. First visit to `/onboarding` calls `/api/onboarding/setup`, which:
   - Ensures default org via `spine_ensure_default_org` RPC
   - Creates the user's first API key (returns raw key once, hashes the rest)
   - Returns memory_count for the polling first-capture detector

### Smoke

```bash
# 1. Open spine.xxiautomate.com/login in an incognito window.
#    Enter a fresh email. Submit.

# 2. Check the inbox — should arrive within ~30s. Click the link.
#    Browser lands on /dashboard/keys with a session cookie set.

# 3. Visit /onboarding. The page polls /api/onboarding/setup. The first
#    response should include a non-null api_key.
curl -i -H "Cookie: <copy from browser>" https://spine.xxiautomate.com/api/onboarding/setup

# Expected JSON:
# { "org_id":"...", "user_email":"…@…", "api_key":"spine_live_…",
#   "key_created":true, "memory_count":0 }

# 4. Use the key for a first capture (mid-thread importance flag).
curl -X POST https://spine.xxiautomate.com/api/capture \
  -H "Authorization: Bearer spine_live_…" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "I prefer Postgres 15 with pgvector. Never MySQL.",
    "type": "fact",
    "source": "smoke",
    "tags": ["db","preference"],
    "importance": "high"
  }'

# Expected:
# { "ok": true, "ids": ["…"], "tier": "high", "score": 0.9 }

# 5. Verify in dashboard.
#    /dashboard/memories should show the row with high signal tier.
```

### Known gaps

- **Resend transactional email is NOT wired.** Supabase's built-in
  email provider is rate-limited and unreliable for production. If the
  magic link doesn't arrive within 60s, that's the cause. Workaround:
  set up a Supabase → Resend SMTP integration in Supabase project
  settings, or paste your own SMTP creds. Untested as of this writing.
- The `/onboarding/setup` route creates an `api_keys` row only on the
  first call. Re-runs return `key_created: false` and `api_key: null`.
  The frontend caches the raw key in `sessionStorage` for the session
  (lost on close). New keys after that go through `/dashboard/keys`.

---

## A2 — Stripe checkout flow

### Code path (verified by reading)

1. `/pricing` → "Upgrade to Pro" button POSTs to `/api/stripe/checkout`
   with `{ plan: 'pro' }` (or `'team'`).
2. Route looks up the price ID:
   - `pro` → `STRIPE_PRICE_ID_PRO`
   - `team` → `STRIPE_PRICE_ID_POWER`  ⚠️ env var name is `_POWER`
     (not `_TEAM`) — historical naming, see `app/api/stripe/checkout/route.ts:11`.
3. Creates a `checkout.sessions.create` with `client_reference_id =
   user.id`, `metadata.user_id = user.id`, `metadata.plan = plan`.
4. User completes Stripe checkout. Stripe sends
   `checkout.session.completed` to `/api/stripe/webhook`.
5. Webhook verifies the signature with `STRIPE_WEBHOOK_SECRET`, reads
   `metadata.user_id` + `metadata.plan`, updates the user's profile row
   with the new plan.

### Required env vars (Vercel Production scope)

```
STRIPE_SECRET_KEY=sk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_ID_PRO=price_…
STRIPE_PRICE_ID_POWER=price_…   # the Team price; legacy name
```

If any are missing, `/api/stripe/checkout` returns 503; `webhook`
returns 400.

### Smoke

```bash
# 1. Sign in as a free user. Confirm plan via /dashboard/billing.

# 2. Hit /pricing → click Upgrade Pro.
#    Network tab: POST /api/stripe/checkout returns { url: "https://checkout.stripe.com/…" }.
#    Browser redirects to Stripe.

# 3. Pay with the test card 4242 4242 4242 4242 (any future date, any CVC).
#    Stripe redirects to /dashboard?upgraded=1.

# 4. Confirm webhook landed:
#    Stripe Dashboard → Developers → Webhooks → most recent event = OK 200.

# 5. Confirm plan flipped:
curl -i -H "Cookie: <session>" https://spine.xxiautomate.com/api/onboarding/setup
# … or check /dashboard/billing (renders `plan` from the profiles row).

# 6. Confirm cap lifted: capture a 201st memory and verify no 403.
```

### Known gaps / inconsistencies

- **Cap source-of-truth (resolved 2026-05-08).** `lib/plan-limits.ts`
  is canonical (`free: 200`). The legacy webhook `PLAN_CAPS` snippet
  (`free: 100`) was rewritten in the Stripe-fix pass — webhook now
  upserts only `plan` / `plan_updated_at` and lets `/api/capture` and
  `/api/check-cap` derive the cap at read-time via `captureCap()`.
- **Pre-tiering grandfather override.** Migration 032 adds
  `profiles.grandfather_cap_override`. `/api/capture` and
  `/api/check-cap` honour it. Backfill SQL is in the migration header
  comment — apply per audit on launch day.
- **No PayPal path tested.** Health endpoint reports
  `paypal_configured: false`. LemonSqueezy is a partial fallback; see
  `lib/plan-limits.ts:84-95` for variant-ID env var names.
- **Cancellation flow not smoked.** Webhook handles
  `customer.subscription.updated` and `.deleted` but the path's been
  exercised less than checkout.

---

## Quick health check before either smoke

```bash
curl -s https://spine.xxiautomate.com/api/health | jq
```

Must show:
```
"db_connected": true
"embedder_configured": true
"embedder_provider": "gemini"
"anthropic_configured": true
```

Anything else → halt and check Vercel env vars before running the
smokes; the routes will silently degrade or 503.
