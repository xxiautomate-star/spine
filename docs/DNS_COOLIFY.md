# DNS + Coolify Setup for spine.xxiautomate.com

## 1. DNS (Namecheap / Cloudflare / wherever xxiautomate.com lives)

Add a CNAME record:

| Host | Type  | Value                          | TTL  |
|------|-------|--------------------------------|------|
| spine | CNAME | your-coolify-vps-ip-or-host   | 3600 |

If using Cloudflare, set proxy to **DNS-only (grey cloud)** — Coolify manages TLS.

If your DNS doesn't support CNAME at sub, use an A record instead:

| Host  | Type | Value              | TTL  |
|-------|------|--------------------|------|
| spine | A    | <Vultr VPS IP>     | 3600 |

Find your Vultr IP at: Vultr console → Instances → your instance → Public IP.

---

## 2. Coolify — Add Domain

1. Open Coolify dashboard → **Applications** → Spine app
2. Click **Domains**
3. Add: `spine.xxiautomate.com`
4. Enable **Generate SSL Certificate** (Let's Encrypt via Traefik)
5. Click Save → Redeploy

Traefik will obtain a TLS cert automatically once DNS propagates (usually <5 minutes).

---

## 3. Verify

```bash
curl -I https://spine.xxiautomate.com/api/ping
# Expect: HTTP/2 200
```

If you get a 502/timeout, check:
- DNS has propagated: `nslookup spine.xxiautomate.com`
- Coolify app is running: check application logs
- Port 3000 is exposed in Dockerfile (it is — confirmed in Dockerfile)

---

## 4. Env Vars in Coolify

In Coolify → Application → Environment Variables, set all of:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_APP_URL=https://spine.xxiautomate.com
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=sk-...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_FREE_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
SPINE_TRIAL_KEY=spine_live_...
SPINE_DEMO_USER_ID=uuid-of-demo-account
```

After setting vars, trigger a redeploy.
