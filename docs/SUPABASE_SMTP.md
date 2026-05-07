# Supabase Auth — wiring Resend as the SMTP provider

> Why this exists: Supabase's built-in email sender is rate-limited (≤2/hour
> on free tier, unreliable at any scale) and uses a generic `noreply@mail.app.supabase.io`
> sender that lands in spam. The first time a stranger signs up at
> `spine.xxiautomate.com/login`, their magic link should arrive within 30
> seconds from a `@xxiautomate.com` sender. Resend gives us both.
>
> A1 audit (session 5) flagged this as a launch blocker the moment a real
> stranger tries to sign up. Fix is dashboard-only — no code change.

---

## What you need before starting

1. **Resend account** with a verified sending domain (`xxiautomate.com`).
   - If the domain isn't verified yet: Resend Dashboard → **Domains** →
     Add `xxiautomate.com`, follow the SPF + DKIM + DMARC TXT records.
     They take 5–60 min to propagate.
2. **Resend SMTP credentials** — `Resend Dashboard → API Keys`. Create a
   key scoped to **Sending access** only (not full access). Copy the
   `re_…` value into the secrets vault under
   `XXIautomate/Business/Passwords.md` as `RESEND_SMTP_PASSWORD`.
3. **Supabase project owner access** — `lnfsyxpyumtigxymukim` on
   [supabase.com/dashboard](https://supabase.com/dashboard).

---

## Wire the SMTP provider

1. Open the Spine project on Supabase. Sidebar → **Project Settings → Auth**.
2. Scroll to **SMTP Settings**. Toggle **Enable Custom SMTP** on.
3. Fill in:

   | Field | Value |
   |---|---|
   | **Host** | `smtp.resend.com` |
   | **Port** | `587` (STARTTLS) — **not** 465 |
   | **Username** | `resend` |
   | **Password** | The `re_…` API key from your vault |
   | **Sender name** | `Spine` |
   | **Sender email** | `auth@xxiautomate.com` (or `noreply@…` if you prefer) |
   | **Min interval between emails** | `0` (Resend handles its own rate limits) |

4. Click **Save**. Supabase performs a test connection — if it can't
   reach Resend on 587, double-check the password (it's the literal
   `re_…` key, not your Resend dashboard password).

> Important: the "Sender email" must use a domain that's verified in
> Resend. Sending from `@gmail.com` etc. will silently bounce.

---

## Update the templates (optional but recommended)

Sidebar → **Authentication → Email Templates**. The defaults work but
read like Supabase, not Spine. Update at minimum the **Magic Link**
template:

```html
<h2>Sign in to Spine</h2>

<p>Click the link below — you'll land on your archive in one tap. The link expires in 60 minutes.</p>

<p><a href="{{ .ConfirmationURL }}">Open Spine</a></p>

<p style="font-size:13px; color:#888; margin-top:32px">
  If you didn't ask for this, ignore the email — your account stays untouched.
</p>
```

Subject line: `Sign in to Spine`. Set **Confirm signup** + **Magic Link**
to the same template content; the redirect URL Supabase ships in
`{{ .ConfirmationURL }}` already handles both flows.

---

## Test the flow

1. Open `spine.xxiautomate.com/login` in an incognito window.
2. Enter a fresh email. Submit.
3. The Resend dashboard → **Logs** should show the message within 5s.
4. Inbox should have the email within 30s. Click the link.
5. Browser lands on `/dashboard/keys` with a session cookie.

If the email never arrives:

| Symptom | Likely cause |
|---|---|
| Resend log: `delivered` but inbox empty | Spam folder. Check, mark as not-spam. Add SPF/DKIM/DMARC if missing. |
| Resend log: `bounced` | Sender domain not verified in Resend. |
| Supabase log: `email rate limit exceeded` | Custom SMTP not actually saved (failed save reverts to built-in). Re-open SMTP settings — toggle should still be on. |
| Resend log: empty | API key is read-only or expired. Generate a new one with sending scope. |

Supabase logs live at **Logs Explorer → Auth Logs**. Resend logs at
**Resend Dashboard → Logs**.

---

## Daily quotas

Resend's free tier: **3,000 emails/month, 100/day**. Spine's worst-case
during a launch spike: ~50 signups + a few dozen team-invite emails per
day. We have headroom.

If we exceed the daily cap, Resend returns 429s; Supabase falls back to
queueing on its own side and retries on the next interval. Magic-link
emails get delayed by minutes, not lost. Bump to the **Pro plan ($20/mo,
50,000/month)** the moment we cross 80 signups in any 24h window —
there's no manual upgrade path mid-spike, the API just fails open.

---

## Out of scope (for now)

- **Outbound product emails** (digest, weekly retention) still use the
  same Resend account but route through `lib/transactional-email.ts` and
  the `/api/cron/*` jobs, NOT through Supabase Auth. Those land
  separately under `RESEND_API_KEY` (HTTPS API, not SMTP) and follow the
  same domain verification.
- **DKIM rotation** — Resend rotates DKIM keys yearly. Watch for the
  reminder email; failure to update breaks deliverability silently.
