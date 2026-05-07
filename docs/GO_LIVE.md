# Spine — Go-Live Checklist

Fresh Supabase project → first paying customer. Run in order.

---

## 1. Create Supabase project

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Region: **ap-southeast-2 (Sydney)** — same region as your Vultr VPS
3. Generate a strong database password and save it somewhere safe
4. Wait for provisioning (~2 min)

---

## 2. Run bootstrap SQL

1. Dashboard → **SQL Editor** → **New query**
2. Paste the entire contents of `supabase/bootstrap.sql`
3. Click **Run** — all tables, indexes, RLS policies, RPCs, and triggers are created in one shot
4. Verify: go to **Table Editor** — you should see `waitlist`, `memories`, `api_keys`, `profiles`, `stripe_events`, `memory_clusters`, `memory_duplicates`

---

## 3. Get Supabase credentials

Dashboard → **Settings → API**:

| Env var | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key (keep secret) |

---

## 4. Seed Stripe products + prices

```bash
STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/seed-stripe.ts
```

This creates two products (`Spine Free`, `Spine Pro`) and two prices (`$0/mo`, `$29/mo`) idempotently. Price IDs are written to `.env.example`.

Copy the output price IDs — you need them in step 5.

---

## 5. Set env vars in Vercel

In the Spine project on Vercel → **Settings → Environment Variables**, add every variable below at the **Production** scope (and **Preview** if you want PR builds to share staging DB). **Do not commit secrets to git.**

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

OPENAI_API_KEY=sk-...

STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...   # see step 6
STRIPE_FREE_PRICE_ID=price_...    # from seed-stripe output
STRIPE_PRO_PRICE_ID=price_...     # from seed-stripe output

NEXT_PUBLIC_APP_URL=https://spine.xxiautomate.com
ENGINE_ACCESS_PASSWORD=           # optional: gate the coming-soon page
```

---

## 6. Register Stripe webhook

1. [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks) → **Add endpoint**
2. URL: `https://spine.xxiautomate.com/api/stripe/webhook`
3. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the **Signing secret** (`whsec_...`) → paste as `STRIPE_WEBHOOK_SECRET` in Vercel env vars (Production scope)

---

## 7. Deploy

```bash
git push origin main
```

Vercel picks up the push, runs `next build` against `saas/spine/` (project root in the dashboard), and ships to `spine.xxiautomate.com`. Watch the build in the Vercel dashboard. A green checkmark means the deployment is live.

Smoke-test: `curl https://spine.xxiautomate.com/api/health` should return `{"ok":true,"db_connected":true,...}`.

> Self-host alternative: see `docs/SELF_HOST.md` for the original Coolify-on-Vultr Dockerfile path. Live deployments use Vercel.

---

## 8. DNS

Point `spine.xxiautomate.com` at Vercel. In your DNS provider:

| Type | Name | Value |
|---|---|---|
| `CNAME` | `spine` | `cname.vercel-dns.com` |

Add the domain in Vercel → **Settings → Domains**. Vercel issues the TLS certificate automatically once the CNAME resolves (usually <2 min).

---

## 9. Chrome Web Store submission

Submit `packages/extension/` (built with `npm run build` inside that directory).

Screenshots required by the Web Store (1280×800 or 640×400):

| # | What to show |
|---|---|
| 1 | Popup open on ChatGPT — queue count + "Up to date" |
| 2 | Popup hygiene section — amber stat row with duplicate + stale counts |
| 3 | Options page — API key field, site toggles, hygiene nudge toggle |
| 4 | Spine dashboard — memory timeline |
| 5 | MCP install one-liner in a terminal next to a Claude conversation that uses a recalled memory |

Privacy policy URL to paste in the submission form: `https://spine.xxiautomate.com/privacy`

Category: **Productivity**. Single purpose statement: *"Captures memories from AI conversations and injects relevant context at the start of new sessions."*

---

## 10. First paying customer

1. Open an incognito window → `https://spine.xxiautomate.com`
2. Sign up with a test email
3. Confirm the profile row was auto-inserted: Supabase → `profiles` table → plan = `free`
4. Install the MCP server: `npx spine-mcp` — paste the API key from the dashboard
5. In Claude Desktop / Claude Code: run `spine_remember("test memory from go-live")` → confirm it appears in the dashboard timeline
6. Go to **Upgrade** → complete Stripe checkout with test card `4242 4242 4242 4242`
7. Confirm: `profiles.plan` updated to `pro`, subscription active in Stripe dashboard
8. Flip to live Stripe keys, remove test mode — you're open for business
