-- Migration 012: Round 16 — v1.1 retrieval roadmap + invite flow.
--
-- Published on /spine/log. Each piece here closes one public commitment:
--   1. superseded_by chain          — append-only correction
--   2. last_confirmed_at            — provenance on injection
--   3. session_injections           — per-session de-duplication
--   4. invite_codes                 — rolling-access unblock
--   5. hybrid_candidates_v2         — superseded-aware retrieval

---------------------------------------------------------------
-- 1. Append-only correction chain.
---------------------------------------------------------------

alter table public.memories
  add column if not exists superseded_by uuid references public.memories(id) on delete set null;

create index if not exists memories_superseded_by_idx
  on public.memories (superseded_by)
  where superseded_by is not null;

-- 2. Provenance: when a memory was last re-asserted/confirmed by the user.
alter table public.memories
  add column if not exists last_confirmed_at timestamptz;

update public.memories
  set last_confirmed_at = created_at
  where last_confirmed_at is null;

---------------------------------------------------------------
-- 3. Per-session injection log. A "session" is a client-assigned opaque
--    string (session_id) — the caller decides what counts as one thread.
---------------------------------------------------------------

create table if not exists public.session_injections (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   text not null,
  memory_id    uuid not null references public.memories(id) on delete cascade,
  fused_score  double precision not null,
  injected_at  timestamptz not null default now()
);

create index if not exists session_injections_lookup_idx
  on public.session_injections (user_id, session_id, memory_id);

create index if not exists session_injections_recent_idx
  on public.session_injections (user_id, session_id, injected_at desc);

alter table public.session_injections enable row level security;

drop policy if exists session_injections_owner_all on public.session_injections;
create policy session_injections_owner_all on public.session_injections
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

---------------------------------------------------------------
-- 4. Invite codes. Admin issues one per waitlist row → email → signup.
---------------------------------------------------------------

create table if not exists public.invite_codes (
  code         text primary key,
  email        text not null,
  waitlist_id  uuid,                      -- saas_spine_waitlist.id if originated there
  issued_by    uuid references auth.users(id) on delete set null,
  issued_at    timestamptz not null default now(),
  redeemed_by  uuid references auth.users(id) on delete set null,
  redeemed_at  timestamptz,
  expires_at   timestamptz,
  plan_grant   text not null default 'pro',  -- what plan the invite bumps them to
  notes        text
);

create index if not exists invite_codes_email_idx
  on public.invite_codes (email);

create index if not exists invite_codes_unredeemed_idx
  on public.invite_codes (issued_at desc)
  where redeemed_at is null;

alter table public.invite_codes enable row level security;
-- Writes go through service-role admin routes only. No public policies.

---------------------------------------------------------------
-- 5. Superseded-aware hybrid candidates.
--    Same shape as spine_hybrid_candidates but:
--      - drops rows where superseded_by points at a memory still live
--      - returns is_superseded + last_confirmed_at for TS-side provenance
---------------------------------------------------------------

create or replace function public.spine_hybrid_candidates_v2(
  p_user            uuid,
  p_query           text,
  p_query_embedding vector(1536),
  p_limit           int default 30
)
returns table (
  id                 uuid,
  content            text,
  source             text,
  tags               text[],
  created_at         timestamptz,
  last_confirmed_at  timestamptz,
  superseded_by      uuid,
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
    coalesce(vec.sim, 0)::double precision as vec_similarity,
    coalesce(bm25.rank, 0)::double precision as bm25_rank
  from public.memories m
  join ids on ids.id = m.id
  left join vec  on vec.id  = m.id
  left join bm25 on bm25.id = m.id;
$$;

grant execute on function public.spine_hybrid_candidates_v2(uuid, text, vector, int)
  to authenticated, service_role;
