-- Migration 015: Round 19 — real labels, not weak supervision.
--
-- Per-candidate recall logging + inferred usage labels + saved weight profiles.
-- Replaces the session_injections-proxy-as-label approach with actual
-- "was this memory surfaced and then cited in the user's next turn" signal.

---------------------------------------------------------------
-- 1. Every /api/search and /api/spine/search hit gets one row.
---------------------------------------------------------------

create table if not exists public.saas_spine_recall_queries (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid,                       -- null for demo/public
  session_id       text,                       -- client-assigned thread identifier
  is_demo          boolean not null default false,
  query            text not null,
  query_hash       text not null,              -- sha256(lower(query)) for dedup + joins
  pool_size        integer not null,
  top_k            integer not null,
  shown_ids        uuid[] not null default '{}'::uuid[],
  provider         text,                       -- cross-encoder provider or null
  weights_snap     jsonb not null,             -- {bm25_w, vec_w, recency_w, centrality_w, bias, model_version}
  latency_ms       integer not null,
  created_at       timestamptz not null default now()
);

create index if not exists recall_queries_user_idx
  on public.saas_spine_recall_queries (user_id, created_at desc);
create index if not exists recall_queries_demo_idx
  on public.saas_spine_recall_queries (is_demo, created_at desc);
create index if not exists recall_queries_session_idx
  on public.saas_spine_recall_queries (user_id, session_id, created_at desc);

alter table public.saas_spine_recall_queries enable row level security;
drop policy if exists recall_queries_owner_read on public.saas_spine_recall_queries;
create policy recall_queries_owner_read on public.saas_spine_recall_queries
  for select using (user_id is null or user_id = auth.uid());

---------------------------------------------------------------
-- 2. Every CANDIDATE (not just the returned top-5) gets one row.
--    This is what the trainer reads — it needs to know what was
--    shown AND what was in the pool but ranked lower.
---------------------------------------------------------------

create table if not exists public.saas_spine_recall_candidates (
  id                 bigserial primary key,
  query_id           uuid not null references public.saas_spine_recall_queries(id) on delete cascade,
  memory_id          uuid,                      -- null-safe: memory may be deleted later
  content_preview    text,                      -- first 160 chars for label inference
  rank_shown         integer,                   -- 1-indexed if shown in top_k, null otherwise
  why_bm25           double precision not null default 0,
  why_vec            double precision not null default 0,
  why_recency        double precision not null default 0,
  why_centrality     double precision not null default 0,
  why_final          double precision not null default 0,
  dominant           text,                      -- bm25 | vec | recency | centrality
  cross_encoder_score double precision,         -- null if fused-only ordering used
  created_at         timestamptz not null default now()
);

create index if not exists recall_candidates_query_idx
  on public.saas_spine_recall_candidates (query_id);
create index if not exists recall_candidates_memory_idx
  on public.saas_spine_recall_candidates (memory_id, created_at desc);

alter table public.saas_spine_recall_candidates enable row level security;
-- Candidates inherit access via their parent query — check via join.
drop policy if exists recall_candidates_owner_read on public.saas_spine_recall_candidates;
create policy recall_candidates_owner_read on public.saas_spine_recall_candidates
  for select using (
    exists (
      select 1 from public.saas_spine_recall_queries q
      where q.id = query_id
        and (q.user_id is null or q.user_id = auth.uid())
    )
  );

---------------------------------------------------------------
-- 3. Labels inferred when the user's next turn cites a shown memory.
--    Signal types:
--      'quoted_phrase' — substring overlap ≥ N words
--      'user_cite'     — explicit UI click / pin (future)
--      'mcp_inject'    — returned by recall and subsequently touched (proxy fallback)
---------------------------------------------------------------

create table if not exists public.saas_spine_recall_labels (
  id           bigserial primary key,
  query_id     uuid not null references public.saas_spine_recall_queries(id) on delete cascade,
  memory_id    uuid,
  was_used     boolean not null,
  signal_type  text not null,
  confidence   double precision not null default 1.0,
  matched_text text,                              -- the phrase that matched, for auditability
  created_at   timestamptz not null default now(),
  unique (query_id, memory_id, signal_type)
);

create index if not exists recall_labels_query_idx
  on public.saas_spine_recall_labels (query_id);
create index if not exists recall_labels_used_idx
  on public.saas_spine_recall_labels (was_used, created_at desc);

alter table public.saas_spine_recall_labels enable row level security;
drop policy if exists recall_labels_owner_read on public.saas_spine_recall_labels;
create policy recall_labels_owner_read on public.saas_spine_recall_labels
  for select using (
    exists (
      select 1 from public.saas_spine_recall_queries q
      where q.id = query_id
        and (q.user_id is null or q.user_id = auth.uid())
    )
  );

---------------------------------------------------------------
-- 4. Weight profiles — users save slider configs from /spine/why.
---------------------------------------------------------------

create table if not exists public.saas_spine_weight_profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  bm25_w          double precision not null,
  vec_w           double precision not null,
  recency_w       double precision not null,
  centrality_w    double precision not null,
  bias            double precision not null default 0,
  notes           text,
  created_at      timestamptz not null default now()
);

create unique index if not exists weight_profiles_user_name_idx
  on public.saas_spine_weight_profiles (user_id, name);

alter table public.saas_spine_weight_profiles enable row level security;
drop policy if exists weight_profiles_owner_all on public.saas_spine_weight_profiles;
create policy weight_profiles_owner_all on public.saas_spine_weight_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

---------------------------------------------------------------
-- 5. Training-data view. Trainer reads this instead of re-assembling joins.
---------------------------------------------------------------

create or replace view public.spine_training_samples as
  select
    q.id                 as query_id,
    q.user_id,
    q.query,
    c.memory_id,
    c.rank_shown,
    c.why_bm25,
    c.why_vec,
    c.why_recency,
    c.why_centrality,
    c.cross_encoder_score,
    coalesce(l.was_used, false) as label,
    coalesce(l.signal_type, 'none') as label_source
  from public.saas_spine_recall_queries q
  join public.saas_spine_recall_candidates c on c.query_id = q.id
  left join lateral (
    select was_used, signal_type
    from public.saas_spine_recall_labels ll
    where ll.query_id = q.id and ll.memory_id = c.memory_id
    order by ll.confidence desc
    limit 1
  ) l on true;

grant select on public.spine_training_samples to authenticated, service_role;
