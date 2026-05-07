-- 032 — Grandfather cap override for pre-signal-tiering accounts
--
-- Closes audit bug A0.0.5 (locked 2026-05-08 morning): the cap gate added
-- in 023 / 031 doesn't differentiate between users whose memories were
-- captured before the gate existed (signal_tier IS NULL, all counted) and
-- new free users hitting the 200 cap legitimately. Roman's account at
-- ~65k memories — every row pre-023 — is fully blocked from new captures.
--
-- Schema:
--   profiles.grandfather_cap_override int — NULL by default. When set,
--     it replaces captureCap(plan) at write-time. Treated as a hard cap,
--     not soft, so a future Pro upgrade still flips them to unlimited.
--   profiles.grandfather_expires_at timestamptz — NULL = no expiry.
--     When set, the override stops applying after that timestamp; we
--     leave the value in the column for forensics.
--
-- Backfill policy (run AFTER apply, not in this migration so it can be
-- audited):
--   UPDATE public.profiles p
--   SET grandfather_cap_override = GREATEST(c.n * 2, 1000),
--       grandfather_expires_at   = now() + interval '90 days'
--   FROM (
--     SELECT user_id, count(*) AS n
--     FROM public.spine_memories
--     WHERE deleted_at IS NULL
--       AND (signal_tier IS NULL OR signal_tier <> 'low')
--     GROUP BY user_id
--     HAVING count(*) > 200
--   ) c
--   WHERE p.user_id = c.user_id
--     AND p.plan = 'free'
--     AND p.grandfather_cap_override IS NULL;
--
-- After the 90-day grace, a follow-up cron can ratchet the override down
-- by some delta per week. That logic doesn't exist yet — schema only.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS grandfather_cap_override int,
  ADD COLUMN IF NOT EXISTS grandfather_expires_at   timestamptz;

COMMENT ON COLUMN public.profiles.grandfather_cap_override IS
  'When set, replaces captureCap(plan) at write-time. Used to keep pre-tiering free users functional without forcing an upgrade.';
COMMENT ON COLUMN public.profiles.grandfather_expires_at IS
  'Optional expiry for the override. NULL = no expiry. Capture route ignores override after this timestamp.';

CREATE INDEX IF NOT EXISTS profiles_grandfather_idx
  ON public.profiles (user_id)
  WHERE grandfather_cap_override IS NOT NULL;
