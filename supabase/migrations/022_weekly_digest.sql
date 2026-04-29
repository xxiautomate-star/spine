-- Migration 022: Weekly multi-session digest rollup.
--
-- Builds on migration 020's `kind` column. Adds 'weekly_digest' as a
-- valid kind so the rollup row stores cleanly in `memories` (reuses
-- embedding + RLS + audit infrastructure).
--
-- coverage_window stores { start, end } ISO timestamps so the dashboard
-- can render "what range did this digest cover?" without parsing the
-- body. Idempotency lives at the lib layer (one row per (user_id,
-- ISO week)) — a uniqueness constraint at the DB level would conflict
-- with append-only on the rare case the LLM call retries.
--
-- Idempotent. Safe to re-run.

-- ── Extend kind constraint ────────────────────────────────────────────────────

alter table public.memories
  drop constraint if exists memories_kind_check;
alter table public.memories
  add constraint memories_kind_check
  check (kind is null or kind in ('turn', 'digest', 'weekly_digest'));

-- ── coverage_window ──────────────────────────────────────────────────────────

alter table public.memories
  add column if not exists coverage_window jsonb;

-- ── Index for weekly-digest lookup ───────────────────────────────────────────

-- Partial index — only weekly_digest rows participate. Lookups go via
-- (user_id, created_at desc) to find "most recent N weekly digests" cheaply.
create index if not exists memories_weekly_digest_idx
  on public.memories (user_id, created_at desc)
  where kind = 'weekly_digest' and deleted_at is null;

-- ── Comments ─────────────────────────────────────────────────────────────────

comment on column public.memories.coverage_window is
  'For weekly_digest rows: { start, end } ISO timestamps describing the time range the rollup covers. Null for other kinds.';
