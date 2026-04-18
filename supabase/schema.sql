-- Spine schema — apply to your Supabase Postgres database.
-- Apply with:
--   psql "$DATABASE_URL" -f supabase/schema.sql
--   — or paste into the Supabase SQL editor.
--
-- Core principle: append-only, infinite memory. No row is ever hard-deleted.

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
-- Phase 2: memories (append-only)
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

-- HNSW index for cosine similarity on live memories.
-- HNSW is available from pgvector 0.5+; Supabase ships recent pgvector.
create index if not exists memories_embedding_hnsw
  on public.memories
  using hnsw (embedding vector_cosine_ops);

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
-- Phase 2: semantic-search RPC
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
  order by m.embedding <=> p_query_embedding
  limit p_limit;
$$;

grant execute on function public.spine_match_memories(uuid, vector, int)
  to authenticated, service_role;
