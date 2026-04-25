-- Migration 013: Round 17 — "proof it remembers a million things".
--
-- Adds:
--   1. is_bench flag on memories — separates synthetic scale-test corpus from
--      real user data so /api/spine-stats can filter it out.
--   2. saas_spine_bench_runs — per-scale latency + accuracy snapshots.
--   3. saas_spine_bench_needles — the identifiable memories used in the
--      needle-in-haystack accuracy test, per run.

---------------------------------------------------------------
-- 1. Tag bench memories.
---------------------------------------------------------------

alter table public.memories
  add column if not exists is_bench boolean not null default false;

create index if not exists memories_is_bench_idx
  on public.memories (is_bench)
  where is_bench = true;

---------------------------------------------------------------
-- 2. Bench runs. One row per (scale, run_at).
---------------------------------------------------------------

create table if not exists public.saas_spine_bench_runs (
  id                uuid primary key default gen_random_uuid(),
  scale             integer not null,      -- total memories in the index at test time
  needle_count      integer not null,      -- how many needles were inserted
  query_count       integer not null,      -- how many queries were run
  top_k             integer not null,      -- retrieval limit used
  needles_found     integer not null,      -- out of (needle_count × query_count)
  recall_accuracy   numeric(6,4) not null, -- needles_found / (needle_count × query_count)
  p50_latency_ms    integer not null,
  p95_latency_ms    integer not null,
  p99_latency_ms    integer not null,
  avg_latency_ms    integer not null,
  max_latency_ms    integer not null,
  embed_model       text,
  git_sha           text,
  notes             text,
  created_at        timestamptz not null default now()
);

create index if not exists saas_spine_bench_runs_scale_idx
  on public.saas_spine_bench_runs (scale desc, created_at desc);

alter table public.saas_spine_bench_runs enable row level security;

-- Public read is safe: bench results are publishable. No PII.
drop policy if exists bench_runs_public_read on public.saas_spine_bench_runs;
create policy bench_runs_public_read on public.saas_spine_bench_runs
  for select
  using (true);

---------------------------------------------------------------
-- 3. Bench needles — the identifiable memories we inject and then
--    verify Spine can find again. Kept for forensic inspection.
---------------------------------------------------------------

create table if not exists public.saas_spine_bench_needles (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid references public.saas_spine_bench_runs(id) on delete cascade,
  memory_id    uuid references public.memories(id) on delete set null,
  token        text not null,       -- the unique token embedded in the needle content
  query        text not null,
  rank         integer,             -- 1-indexed position of the needle in the result set, null if not found
  similarity   double precision,
  found        boolean not null,
  created_at   timestamptz not null default now()
);

create index if not exists saas_spine_bench_needles_run_idx
  on public.saas_spine_bench_needles (run_id);

alter table public.saas_spine_bench_needles enable row level security;
-- Service role only — no public policy needed.
