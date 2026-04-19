-- Spine schema — apply to your Supabase Postgres database.
-- Apply with:
--   psql "$DATABASE_URL" -f supabase/schema.sql
--   — or paste into the Supabase SQL editor.
--
-- Core principle: append-only, infinite memory. Explicit user-driven forget is a
-- hard delete; the engine itself never summarises or compresses.

create extension if not exists vector;
create extension if not exists pgcrypto;

---------------------------------------------------------------
-- Phase 1: waitlist
---------------------------------------------------------------

create table if not exists public.waitlist (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  tier_interest text,
  use_case      text,
  referrer      text,
  created_at    timestamptz not null default now()
);

---------------------------------------------------------------
-- Phase 2–4: memories (append-only, vector + BM25)
---------------------------------------------------------------

create table if not exists public.memories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    text not null,
  source     text,
  tags       text[] default '{}'::text[],
  embedding  vector(1536),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Phase 4 migration: generated tsvector + GIN index for BM25.
alter table public.memories
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists memories_embedding_hnsw
  on public.memories
  using hnsw (embedding vector_cosine_ops);

create index if not exists memories_content_tsv_gin
  on public.memories using gin (content_tsv);

create index if not exists memories_user_created_idx
  on public.memories (user_id, created_at desc);

alter table public.memories enable row level security;

drop policy if exists memories_owner_all on public.memories;
create policy memories_owner_all on public.memories
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

---------------------------------------------------------------
-- Phase 2: API keys (for MCP cloud-mode auth)
---------------------------------------------------------------

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  key_hash     text not null unique,
  name         text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists api_keys_user_idx on public.api_keys (user_id);

alter table public.api_keys enable row level security;

drop policy if exists api_keys_owner_all on public.api_keys;
create policy api_keys_owner_all on public.api_keys
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

---------------------------------------------------------------
-- Phase 4b: profiles (plan tier)
-- `plan` values: 'free' | 'pro' | 'power'. Default 'free'.
-- Free plan skips Haiku rerank and returns pure pgvector top 5.
---------------------------------------------------------------

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  plan       text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_owner_read on public.profiles;
create policy profiles_owner_read on public.profiles
  for select using (user_id = auth.uid());

-- On every new auth user, auto-insert a free-tier profile row.
create or replace function public.spine_handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists spine_on_auth_user_created on auth.users;
create trigger spine_on_auth_user_created
  after insert on auth.users
  for each row execute function public.spine_handle_new_user();

---------------------------------------------------------------
-- Phase 2: semantic-search RPC (pure pgvector — used by /api/recall/raw)
---------------------------------------------------------------

create or replace function public.spine_match_memories(
  p_user uuid,
  p_query_embedding vector(1536),
  p_limit int default 10
)
returns table (
  id         uuid,
  content    text,
  source     text,
  tags       text[],
  created_at timestamptz,
  similarity double precision
)
language sql
stable
as $$
  select
    m.id,
    m.content,
    m.source,
    m.tags,
    m.created_at,
    1 - (m.embedding <=> p_query_embedding) as similarity
  from public.memories m
  where m.user_id = p_user
    and m.deleted_at is null
    and m.embedding is not null
  order by m.embedding <=> p_query_embedding
  limit p_limit;
$$;

grant execute on function public.spine_match_memories(uuid, vector, int)
  to authenticated, service_role;

---------------------------------------------------------------
-- Phase 4: hybrid candidate fetch (vector + BM25 union)
-- Returns up to 2*p_limit candidates with both signals so we can
-- fuse + rerank in the app layer.
---------------------------------------------------------------

create or replace function public.spine_hybrid_candidates(
  p_user uuid,
  p_query text,
  p_query_embedding vector(1536),
  p_limit int default 30
)
returns table (
  id             uuid,
  content        text,
  source         text,
  tags           text[],
  created_at     timestamptz,
  vec_similarity double precision,
  bm25_rank      double precision
)
language sql
stable
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
      ts_rank(m.content_tsv, websearch_to_tsquery('english', p_query)) as rank
    from public.memories m
    where m.user_id = p_user
      and m.deleted_at is null
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
    coalesce(vec.sim, 0)::double precision as vec_similarity,
    coalesce(bm25.rank, 0)::double precision as bm25_rank
  from public.memories m
  join ids on ids.id = m.id
  left join vec  on vec.id  = m.id
  left join bm25 on bm25.id = m.id;
$$;

grant execute on function public.spine_hybrid_candidates(uuid, text, vector, int)
  to authenticated, service_role;
