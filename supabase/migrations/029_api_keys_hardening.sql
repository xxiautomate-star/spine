-- 029 — API key hardening (Gate E)
--
-- Three new dimensions on api_keys + a receipts table for the audit trail.
-- Compaction thesis stays intact: we don't compact key usage history, we
-- log receipts. Most AI tools rotate-and-forget; Spine remembers every use.
--
-- Adds:
--   scope         — 'full' | 'read' | 'write' | 'read_write'
--                   Default 'full' so existing keys keep working.
--   expires_at    — timestamptz, nullable. When set + in the past → 401.
--   use_count     — integer, monotonic. Bumped per authed request.
--
-- Skips (already on table):
--   name          — used as the human label; we reuse this rather than
--                   adding a redundant `label` column.
--   last_used_at  — already there from the original migration.

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'full';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_scope_check'
  ) THEN
    ALTER TABLE public.api_keys
      ADD CONSTRAINT api_keys_scope_check
      CHECK (scope IN ('full', 'read', 'write', 'read_write'));
  END IF;
END $$;

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS api_keys_expires_at_idx
  ON public.api_keys(expires_at)
  WHERE expires_at IS NOT NULL;

-- ------------------------------------------------------------------------
-- Receipts table — one row per authed API call. The dashboard surfaces
-- the most recent N for each key so users can audit "where is this key
-- being used?" before they revoke it.
--
-- Volume: high. We do NOT keep receipts forever — a separate cron prunes
-- to the last 100 per key (job lives at /api/cron/key-receipts-prune,
-- shipped in this same PR).
-- ------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.api_key_uses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id          uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route           text NOT NULL,                  -- e.g. '/api/recall'
  scope_required  text,                           -- which scope the route asked for
  status_code     integer,                        -- HTTP status returned
  ts              timestamptz NOT NULL DEFAULT now()
);

-- Per-key reverse-chronological reads + cleanup scans both go through this index.
CREATE INDEX IF NOT EXISTS api_key_uses_key_ts_idx
  ON public.api_key_uses(key_id, ts DESC);

ALTER TABLE public.api_key_uses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_key_uses_owner_read ON public.api_key_uses;
CREATE POLICY api_key_uses_owner_read ON public.api_key_uses
  FOR SELECT USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------
-- spine_log_key_use(p_key_id, p_user_id, p_route, p_scope, p_status)
--   Atomic: insert receipt + bump use_count + last_used_at.
--   Fire-and-forget caller — we do not block the request on this.
-- ------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION spine_log_key_use(
  p_key_id uuid,
  p_user_id uuid,
  p_route text,
  p_scope text,
  p_status integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO api_key_uses (key_id, user_id, route, scope_required, status_code)
  VALUES (p_key_id, p_user_id, p_route, p_scope, p_status);

  UPDATE api_keys
     SET use_count = use_count + 1,
         last_used_at = now()
   WHERE id = p_key_id;
END;
$$;

-- ------------------------------------------------------------------------
-- spine_prune_key_uses(p_keep_per_key int)
--   Trim api_key_uses so each key keeps only its last N receipts. Called
--   by /api/cron/key-receipts-prune nightly. Bounds storage growth to
--   O(active keys × keep_per_key) rather than O(total requests).
-- ------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION spine_prune_key_uses(p_keep_per_key int DEFAULT 100)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count bigint;
BEGIN
  WITH ranked AS (
    SELECT id,
           row_number() OVER (PARTITION BY key_id ORDER BY ts DESC) AS rn
    FROM api_key_uses
  ),
  deleted AS (
    DELETE FROM api_key_uses
    WHERE id IN (SELECT id FROM ranked WHERE rn > p_keep_per_key)
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$$;
