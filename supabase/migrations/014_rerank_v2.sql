-- Migration 014: Round 18 — hybrid rerank v2 with learned weights + why trace.
--
-- NO STORAGE CHANGES. All of this is ranking infrastructure.
--
-- Adds:
--   1. memories.centrality        — personalized PageRank score, refreshed offline
--   2. spine_rerank_weights       — versioned weight rows from the trainer
--   3. spine_hybrid_candidates_v3 — returns raw per-signal scores (BM25/vec/age/centrality)

---------------------------------------------------------------
-- 1. Centrality column — computed by scripts/compute-centrality.mjs
---------------------------------------------------------------

alter table public.memories
  add column if not exists centrality double precision not null default 0;

create index if not exists memories_centrality_idx
  on public.memories (user_id, centrality desc);

---------------------------------------------------------------
-- 2. Versioned rerank weights.
--    Exactly one row per user_id is active (is_active = true) at a time.
--    Training pipeline writes a new row + flips active atomically.
---------------------------------------------------------------

create table if not exists public.spine_rerank_weights (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid,                           -- null = global default
  bm25_w         double precision not null,
  vec_w          double precision not null,
  recency_w      double precision not null,
  centrality_w  double precision not null,
  bias           double precision not null default 0,
  training_n     integer not null default 0,     -- # training samples
  training_auc   double precision,               -- diagnostic
  model_version  text not null default 'lr-v1',
  is_active      boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now()
);

create unique index if not exists spine_rerank_weights_active_user_idx
  on public.spine_rerank_weights (user_id)
  where is_active = true and user_id is not null;

create unique index if not exists spine_rerank_weights_active_global_idx
  on public.spine_rerank_weights ((true))
  where is_active = true and user_id is null;

-- Seed the default global weights if none exist. Informed priors from the
-- existing RRF-fused path: vector dominates, BM25 is a strong secondary,
-- recency is a light tiebreaker, centrality is a subtle nudge.
insert into public.spine_rerank_weights
  (user_id, bm25_w, vec_w, recency_w, centrality_w, bias, training_n, model_version, notes)
select null, 0.25, 0.55, 0.10, 0.10, 0.0, 0, 'default-v1', 'hand-tuned priors — no training yet'
where not exists (
  select 1 from public.spine_rerank_weights where user_id is null and is_active = true
);

alter table public.spine_rerank_weights enable row level security;

-- Users read their own (or fall back to global).
drop policy if exists rerank_weights_own_or_global_read on public.spine_rerank_weights;
create policy rerank_weights_own_or_global_read on public.spine_rerank_weights
  for select
  using (user_id is null or user_id = auth.uid());

---------------------------------------------------------------
-- 3. Candidates RPC that returns raw signals, NOT pre-fused.
--    TS layer does the fusion so it can apply the active weight row
--    and emit the per-memory why object.
---------------------------------------------------------------

create or replace function public.spine_hybrid_candidates_v3(
  p_user            uuid,
  p_query           text,
  p_query_embedding vector(1536),
  p_limit           int default 40
)
returns table (
  id                 uuid,
  content            text,
  source             text,
  tags               text[],
  created_at         timestamptz,
  last_confirmed_at  timestamptz,
  superseded_by      uuid,
  centrality         double precision,
  vec_similarity     double precision,
  bm25_rank          double precision
)
language sql stable
as $$
  with vec as (
    select
      m.id,
      1 - (m.embedding <=> p_query_embedding) as sim
    from public.memories m
    where m.user_id = p_user
      and m.deleted_at is null
      and m.embedding is not null
    order by m.embedding <=> p_query_embedding
    limit p_limit
  ),
  bm25 as (
    select
      m.id,
      ts_rank(m.content_tsv, websearch_to_tsquery('english', coalesce(p_query, ''))) as rank
    from public.memories m
    where m.user_id = p_user
      and m.deleted_at is null
      and p_query is not null
      and length(trim(p_query)) > 0
      and m.content_tsv @@ websearch_to_tsquery('english', p_query)
    order by rank desc
    limit p_limit
  ),
  ids as (
    select id from vec
    union
    select id from bm25
  )
  select
    m.id,
    m.content,
    m.source,
    m.tags,
    m.created_at,
    m.last_confirmed_at,
    m.superseded_by,
    coalesce(m.centrality, 0)::double precision,
    coalesce(vec.sim, 0)::double precision as vec_similarity,
    coalesce(bm25.rank, 0)::double precision as bm25_rank
  from public.memories m
  join ids on ids.id = m.id
  left join vec  on vec.id  = m.id
  left join bm25 on bm25.id = m.id;
$$;

grant execute on function public.spine_hybrid_candidates_v3(uuid, text, vector, int)
  to authenticated, service_role;
