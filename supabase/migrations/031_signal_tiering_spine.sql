-- 031 — signal tiering on spine_memories
--
-- Migration 023 added signal_score / signal_tier / signal_reason columns
-- to public.memories — but prod runs the spine_-prefixed names (the
-- supabase service.ts proxy doubles names). 023 was effectively a no-op
-- against this deployment. /api/capture writes signal_score and
-- signal_tier on every insert; without these columns each capture would
-- 500 the moment a real user lands. Closes that gap.
--
-- Adds:
--   signal_score   numeric(3,2)  — Haiku rating 0.00–1.00
--   signal_tier    text          — 'high' | 'standard' | 'low'
--   signal_reason  text          — ≤80-char tooltip text
--
-- Plus the partial index migration 023 specified for the dashboard
-- timeline tier-filter rail.
--
-- Append-only preserved. Existing 0-row state means no backfill is
-- required; future rows always carry a tier (the route writes one for
-- every capture, even when the scorer is unreachable).
--
-- Idempotent. Safe to re-run.

ALTER TABLE public.spine_memories
  ADD COLUMN IF NOT EXISTS signal_score   numeric(3,2),
  ADD COLUMN IF NOT EXISTS signal_tier    text,
  ADD COLUMN IF NOT EXISTS signal_reason  text;

ALTER TABLE public.spine_memories
  DROP CONSTRAINT IF EXISTS spine_memories_signal_tier_check;
ALTER TABLE public.spine_memories
  ADD CONSTRAINT spine_memories_signal_tier_check
  CHECK (signal_tier IS NULL OR signal_tier IN ('high', 'standard', 'low'));

CREATE INDEX IF NOT EXISTS spine_memories_signal_tier_idx
  ON public.spine_memories (user_id, signal_tier, created_at DESC)
  WHERE deleted_at IS NULL AND signal_tier IS NOT NULL;

COMMENT ON COLUMN public.spine_memories.signal_score IS
  'Haiku-rated signal quality, 0.00-1.00. 0-0.4 = noise; 0.4-0.7 = standard; 0.7-1.0 = high signal worth remembering long-term.';
COMMENT ON COLUMN public.spine_memories.signal_tier IS
  'Bucket derived from signal_score at capture time. NULL for legacy rows captured before this migration.';
COMMENT ON COLUMN public.spine_memories.signal_reason IS
  'One-line (<=80 chars) explanation of the score. Surfaced as a dashboard tooltip and aids debugging.';
