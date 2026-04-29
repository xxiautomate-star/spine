-- Migration 023: Signal-quality tiering on memories.
--
-- Every memory capture now gets scored 0–1 by Haiku. Score → tier:
--   ≥ 0.70 → 'high'      — embedded, auto-pinnable, surfaces in semantic recall
--   0.40–0.70 → 'standard' — embedded, current behavior
--   < 0.40 → 'low'       — stored without embedding, invisible to semantic
--                          search, recallable via timeline only
--
-- Append-only is preserved. Low-signal memories are still kept forever
-- and exportable. They just don't pollute semantic search.
--
-- Backwards compatible — existing rows have signal_tier = null and behave
-- exactly as before (existing recall queries filter on embedding presence,
-- which already excludes nothing for legacy rows).
--
-- Idempotent. Safe to re-run.

-- ── Columns ──────────────────────────────────────────────────────────────────

alter table public.memories
  add column if not exists signal_score numeric(3,2),
  add column if not exists signal_tier  text,
  add column if not exists signal_reason text;

alter table public.memories
  drop constraint if exists memories_signal_tier_check;
alter table public.memories
  add constraint memories_signal_tier_check
  check (signal_tier is null or signal_tier in ('high', 'standard', 'low'));

-- ── Index for tier-filtered counts + dashboard rails ─────────────────────────

-- Partial index — only scored rows participate. Lookups go via
-- (user_id, signal_tier, created_at desc) for dashboard counts and the
-- timeline tier-filter rail.
create index if not exists memories_signal_tier_idx
  on public.memories (user_id, signal_tier, created_at desc)
  where deleted_at is null and signal_tier is not null;

-- ── Comments ─────────────────────────────────────────────────────────────────

comment on column public.memories.signal_score is
  'Haiku-rated signal quality, 0.00–1.00. 0–0.4 = noise; 0.4–0.7 = standard; 0.7–1.0 = high signal worth remembering long-term.';
comment on column public.memories.signal_tier is
  'Bucket derived from signal_score at capture time. NULL for legacy rows captured before this migration.';
comment on column public.memories.signal_reason is
  'One-line (≤80 chars) explanation of the score. Surfaced as a dashboard tooltip and aids debugging.';
