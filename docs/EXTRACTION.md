# Spine Supabase Extraction Runbook

> Pull Spine's data + schema OUT of the consolidated AA project (`lnfsyxpyumtigxymukim`) into a dedicated `spine` project. Staged cutover, no destructive moves until verified.

> **Path chosen 2026-04-29:** self-host Supabase on Vultr/Coolify (free, owned).
> The detailed self-host playbook is at `infra/spine-supabase-self-host.md` —
> it supersedes Step 1 + Step 2 of this runbook. Steps 3-7 (data mirror,
> env swap, verification window, decommission, memory update) still apply
> identically to either cloud or self-hosted target.

**Context:** AA / Spine / Leads / Content Autopilot share the consolidated Supabase project per `memory/project_supabase_project_registry.md` (consolidation date 2026-04-20). Spine launching to paying customers fires the documented split trigger: *"Any SaaS goes multi-tenant — split immediately, RLS isolation is no longer optional."* Per the 2026-04-29 tools lock, AA / Leads / Content Autopilot are dead-coded; only Spine actively needs extraction.

The Spine schema is portable across projects (3 env vars + rebuild — see `SELF_HOST.md`). This runbook is purely operational: stand up new project, mirror data, swap env, verify, decommission old tables.

---

## Pre-flight

- [ ] You have admin access to the AA Supabase project (`lnfsyxpyumtigxymukim`) — for export.
- [ ] You have authority to create a new Supabase project under `xxiautomate@gmail.com` org.
- [ ] You have Coolify access to update env vars on `spine.xxiautomate.com`.
- [ ] Estimated downtime window: **zero** if staged correctly. Worst case: 2 minutes during the env-var swap rebuild.

---

## Step 1 — Stand up the new Spine project

1. Open Supabase dashboard → org `xxiautomate@gmail.com` → "New Project".
2. Name: `spine`. Region: `Sydney (ap-southeast-2)`. Generate strong DB password — save to `secrets_credentials.md` immediately.
3. Once provisioned (~2 min), grab from Settings → API:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role secret` key → `SUPABASE_SERVICE_ROLE_KEY`

**Free-tier check:** xxiautomate org may already be at the 2-project limit (engine + AA-consolidated). If so, two options:
- Upgrade org to Pro ($25/mo) — cleanest, supports multiple paid projects.
- Or migrate Spine to **self-hosted Supabase on Coolify** (per `saas/_shared/` self-host instructions) — zero extra Supabase Cloud cost, but you operate the Postgres.

Recommendation: Pro upgrade. $25/mo is trivial against Spine SaaS revenue, removes operational burden.

---

## Step 2 — Apply Spine schema to the new project

```bash
# In Supabase Studio for the NEW spine project: SQL Editor → paste this entire file → Run
saas/spine/supabase/migrations/_CONSOLIDATED_FRESH_PROJECT.sql
```

This file is idempotent and contains bootstrap.sql + migrations 002–017. Tables created:
`memories`, `profiles`, `api_keys`, `waitlist`, `entity_graph`, `team_members`, `digests`, `conflicts`, `decisions`, etc. (No prefix — already designed for a dedicated project.)

Then apply in-flight migrations IN ORDER (each idempotent, but order matters
because 022/023 modify columns added by 020):

```bash
# 019 — onboarding emails (already on main)
saas/spine/supabase/migrations/019_onboarding_emails.sql

# 020 — conversation capture (PR #30)
saas/spine/supabase/migrations/020_conversation_capture.sql

# 022 — weekly digest rollup (PR #33)
saas/spine/supabase/migrations/022_weekly_digest.sql

# 023 — quality gate + signal tiering (PR #39)
saas/spine/supabase/migrations/023_signal_tiering.sql
```

If any PR is unmerged at migration time, paste from the PR branch directly.
The four PRs all stack: 30 → 33 → 39, with 35 (labs dogfood) parallel and
code-only. Merging in order before the cutover is cleanest.

Verify schema: `select count(*) from information_schema.tables where table_schema='public';` — should be ~20 tables. Also:

```sql
-- Brief 023 quality-gate columns present?
SELECT column_name FROM information_schema.columns
WHERE table_name='memories' AND column_name LIKE 'signal_%';
-- expect: signal_score, signal_tier, signal_reason

-- Brief 020/022 conversation columns present?
SELECT column_name FROM information_schema.columns
WHERE table_name='memories'
  AND column_name IN ('session_id','kind','tool_name','files_touched','coverage_window');
-- expect all 5
```

---

## Step 3 — Mirror data from the consolidated project

The consolidated project has Spine data in `spine_*` prefixed tables. Need to copy across, dropping the prefix.

**Option A — `pg_dump` + `pg_restore` (recommended, ~5 min):**

```bash
# Dump only spine_* tables from consolidated, with prefix-strip via sed
pg_dump "$AA_DATABASE_URL" \
  -t 'public.spine_*' \
  --data-only \
  --column-inserts \
  | sed 's/spine_memories/memories/g; s/spine_api_keys/api_keys/g; s/spine_embeddings/embeddings/g; s/spine_sessions/sessions/g; s/spine_digests/digests/g' \
  | psql "$NEW_SPINE_DATABASE_URL"
```

(Adjust the sed expressions for any other `spine_*` tables that exist — verify with `\dt spine_*` against the AA project first.)

**Option B — Supabase Studio export (UI, slower):**

For each `spine_*` table:
1. AA project → Table editor → `spine_memories` → Export as CSV.
2. Import into new project's `memories` table (drop prefix).
3. Repeat for each table.

Use Option A unless you don't have psql installed.

---

## Step 4 — Swap env vars on `spine.xxiautomate.com`

In Coolify, edit the Spine application service env:

```
NEXT_PUBLIC_SUPABASE_URL=https://<new-spine-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<new-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<new-service-role-key>
```

Trigger a rebuild — `NEXT_PUBLIC_*` vars are inlined at build time, so a redeploy (not just restart) is required:

```bash
git commit --allow-empty -m "chore(spine): trigger rebuild for Supabase project swap"
git push origin main
```

Coolify auto-deploys. ~2 min build + cutover.

### Labs dogfood (PR #35) env swap

The labs `/api/labs/spine-dogfood` route reads weekly_digest rows directly
from Spine's Supabase. Three env vars on the labs Coolify service:

```
SPINE_SUPABASE_URL=<new spine project URL>
SPINE_SUPABASE_SERVICE_ROLE_KEY=<new service-role key>
LABS_DOGFOOD_USER_ID=<roman's auth.users.id on the NEW project>
```

**Heads-up on `LABS_DOGFOOD_USER_ID`:** if you're moving to a fresh project
(not mirroring users), Roman's user_id changes. Sign in to the new project
once after Step 1, then grab the UUID:

```sql
-- In Studio → SQL Editor on the new project:
SELECT id, email FROM auth.users WHERE email = 'xxiautomate@gmail.com';
```

Paste that UUID into `LABS_DOGFOOD_USER_ID`. Without this swap the dogfood
card returns `mode: empty` forever (no rows under the old user_id).

Update `saas/spine/.env.local` for local dev too (don't commit it).

---

## Step 5 — Verification window (24-48h)

Spine reads exclusively from the new project. Old `spine_*` tables remain in the consolidated project as live backup.

Verify:

- [ ] `spine.xxiautomate.com` loads, login works (auth tables migrated).
- [ ] `/sessions/[id]` shows historical sessions (data migrated correctly).
- [ ] New session captured via MCP tool → appears in new project's `memories` table (writes hit new project).
- [ ] `/api/recall/recent` returns expected results (RPC functions migrated).
- [ ] `/api/recall/weekly-digest` works (migration 022 applied).
- [ ] No errors in Coolify logs referencing missing tables/columns.
- [ ] PR #35 dogfood card on `labs.xxiautomate.com` displays (labs envs swapped).

If anything breaks: env-var-flip Coolify back to consolidated project URL/keys, redeploy. Roll forward by debugging the new project. **Zero data loss** because old project still has everything.

---

## Step 6 — Decommission `spine_*` from the consolidated project

After 48h verification with no incidents:

```sql
-- Run against AA consolidated project (lnfsyxpyumtigxymukim)
DROP TABLE IF EXISTS public.spine_memories CASCADE;
DROP TABLE IF EXISTS public.spine_api_keys CASCADE;
DROP TABLE IF EXISTS public.spine_embeddings CASCADE;
DROP TABLE IF EXISTS public.spine_sessions CASCADE;
DROP TABLE IF EXISTS public.spine_digests CASCADE;
-- etc. for any other spine_* tables identified in step 3
```

Frees up rows + storage in the consolidated project.

---

## Step 7 — Update memory

Edit `memory/project_supabase_project_registry.md`:

```markdown
| App | Project Name | Project ID | Region | Status |
|---|---|---|---|---|
| Spine | `spine` | <new-id> | Sydney | EXTRACTED 2026-XX-XX |
| AA + Leads + Content Autopilot (dead-coded, archive only) | `autonomous-architect` | `lnfsyxpyumtigxymukim` | Sydney | Spine extracted; leftover tables for dead products. Drop project entirely if free tier caps. |
| Engine | `xxiautomate` (legacy) | _separate_ | — | Unchanged |
```

---

## Rollback recipe

If anything goes wrong post-cutover and you need to abort:

```bash
# 1. Coolify: revert env vars to consolidated project URL/keys
# 2. Trigger rebuild
git commit --allow-empty -m "chore(spine): rollback Supabase swap"
git push origin main
# 3. Verify Spine is reading from consolidated project again
```

The new project keeps all its data — try again later.

---

## Out of scope (separate work)

- **Stripe → PayPal swap.** Spine has Stripe scaffolding from a pre-decision sprint (`app/api/stripe/*`, `lib/stripe.ts`, `app/pricing/PricingClient.tsx`, `scripts/seed-stripe.ts`). This runbook only covers the database extraction. Payment-rail swap is its own brief — Roman 2026-04-29 locked PayPal Business + custom UI.
- **Local mode.** Per Roman 2026-04-29, Spine should support local SQLite/Postgres mode so users can run it entirely offline. The `store/` interface from PR #30 (021) already supports this in code; needs CLI flags + docs.
- **Tier limits & rate limiting.** Define Free / Pro / Team caps. Wire into request middleware.

These are dispatched as follow-up briefs, not part of this extraction.
