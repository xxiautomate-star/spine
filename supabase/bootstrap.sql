-- Spine — idempotent bootstrap SQL
-- Paste the entire file into your Supabase SQL editor and click Run.
-- Safe to run on a fresh project or re-run on an existing one.
-- Every statement uses IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS.

-- ---------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Schema grants (safe to re-run; no-op if already present)
-- ---------------------------------------------------------------

grant usage on schema public to anon, authenticated;

-- ---------------------------------------------------------------
-- waitlist
-- ---------------------------------------------------------------

create table if not exists public.waitlist (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  tier_interest text,
  use_case      text,
  referrer      text,
  created_at    timestamptz not null default now()
);

alter table public.waitlist enable row level security;

drop policy if exists waitlist_insert_anon on public.waitlist;
create policy waitlist_insert_anon on public.waitlist
  for insert to anon with check (true);

grant insert on public.waitlist to anon;
grant select, insert, update, delete on public.waitlist to authenticated;

-- ---------------------------------------------------------------
-- memories
-- ---------------------------------------------------------------

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

-- Phase 4: tsvector for BM25 hybrid search
alter table public.memories
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

-- Phase 8: hygiene columns
alter table public.memories
  add column if not exists cluster_id        uuid,
  add column if not exists retrieval_count   integer not null default 0,
  add column if not exists last_retrieved_at timestamptz;

create index if not exists memories_embedding_hnsw
  on public.memories using hnsw (embedding vector_cosine_ops);

create index if not exists memories_content_tsv_gin
  on public.memories using gin (content_tsv);

create index if not exists memories_user_created_idx
  on public.memories (user_id, created_at desc);

create index if not exists memories_cluster_idx
  on public.memories (cluster_id);

create index if not exists memories_retrieval_idx
  on public.memories (user_id, last_retrieved_at);

alter table public.memories enable row level security;

drop policy if exists memories_owner_all on public.memories;
create policy memories_owner_all on public.memories
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.memories to authenticated;

-- ---------------------------------------------------------------
-- api_keys
-- ---------------------------------------------------------------

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

grant select, insert, update, delete on public.api_keys to authenticated;

-- ---------------------------------------------------------------
-- profiles  (plan: 'free' | 'pro' | 'power')
-- ---------------------------------------------------------------

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  plan       text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Phase 6: Stripe billing fields
alter table public.profiles
  add column if not exists stripe_customer_id     text unique,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id        text,
  add column if not exists plan_updated_at        timestamptz;

create index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id);

alter table public.profiles enable row level security;

drop policy if exists profiles_owner_read on public.profiles;
create policy profiles_owner_read on public.profiles
  for select using (user_id = auth.uid());

grant select on public.profiles to authenticated;

-- Trigger: insert a free-tier profile row for every new auth user.
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

-- ---------------------------------------------------------------
-- stripe_events  (idempotency log — service role only)
-- ---------------------------------------------------------------

create table if not exists public.stripe_events (
  event_id     text primary key,
  type         text not null,
  received_at  timestamptz not null default now(),
  payload      jsonb
);

alter table public.stripe_events enable row level security;

drop policy if exists stripe_events_deny_all on public.stripe_events;
create policy stripe_events_deny_all on public.stripe_events
  for select using (false);

-- ---------------------------------------------------------------
-- memory_clusters  (Phase 8 hygiene)
-- ---------------------------------------------------------------

create table if not exists public.memory_clusters (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  label      text not null,
  centroid   vector(1536) not null,
  size       integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memory_clusters_user_idx
  on public.memory_clusters (user_id);

alter table public.memory_clusters enable row level security;

drop policy if exists clusters_owner_all on public.memory_clusters;
create policy clusters_owner_all on public.memory_clusters
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.memory_clusters to authenticated;

-- ---------------------------------------------------------------
-- memory_duplicates  (Phase 8 hygiene)
-- ---------------------------------------------------------------

create table if not exists public.memory_duplicates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  memory_id_a uuid not null references public.memories(id) on delete cascade,
  memory_id_b uuid not null references public.memories(id) on delete cascade,
  similarity  double precision not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint memory_duplicates_pair unique (memory_id_a, memory_id_b)
);

create index if not exists memory_duplicates_user_idx
  on public.memory_duplicates (user_id, detected_at desc)
  where resolved_at is null;

alter table public.memory_duplicates enable row level security;

drop policy if exists duplicates_owner_all on public.memory_duplicates;
create policy duplicates_owner_all on public.memory_duplicates
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.memory_duplicates to authenticated;

-- ---------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------

-- Pure vector recall (used by /api/recall/raw)
create or replace function public.spine_match_memories(
  p_user            uuid,
  p_query_embedding vector(1536),
  p_limit           int default 10
)
returns table (
  id         uuid,
  content    text,
  source     text,
  tags       text[],
  created_at timestamptz,
  similarity double precision
)
language sql stable
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

-- Hybrid vector + BM25 candidate fetch (used by /api/recall)
create or replace function public.spine_hybrid_candidates(
  p_user            uuid,
  p_query           text,
  p_query_embedding vector(1536),
  p_limit           int default 30
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

-- Nearest cluster centroid (hygiene — cluster assignment)
create or replace function public.spine_nearest_cluster(
  p_user      uuid,
  p_embedding vector(1536)
)
returns table (
  id         uuid,
  label      text,
  similarity double precision
)
language sql stable
as $$
  select
    c.id,
    c.label,
    1 - (c.centroid <=> p_embedding) as similarity
  from public.memory_clusters c
  where c.user_id = p_user
  order by c.centroid <=> p_embedding
  limit 1;
$$;

grant execute on function public.spine_nearest_cluster(uuid, vector)
  to authenticated, service_role;

-- Duplicate pair detection across the full corpus
create or replace function public.spine_detect_duplicates(
  p_user      uuid,
  p_threshold double precision default 0.92,
  p_limit     int default 200
)
returns table (
  memory_id_a uuid,
  memory_id_b uuid,
  similarity  double precision
)
language sql stable
as $$
  select
    m1.id as memory_id_a,
    m2.id as memory_id_b,
    1 - (m1.embedding <=> m2.embedding) as similarity
  from public.memories m1
  join public.memories m2
    on m2.user_id = m1.user_id
   and m2.id > m1.id
  where m1.user_id = p_user
    and m1.deleted_at is null
    and m2.deleted_at is null
    and m1.embedding is not null
    and m2.embedding is not null
    and 1 - (m1.embedding <=> m2.embedding) > p_threshold
  order by 1 - (m1.embedding <=> m2.embedding) desc
  limit p_limit;
$$;

grant execute on function public.spine_detect_duplicates(uuid, double precision, int)
  to authenticated, service_role;

-- Bump retrieval stats (called by /api/recall after returning results)
create or replace function public.spine_touch_retrieved(
  p_user uuid,
  p_ids  uuid[]
)
returns void
language sql
as $$
  update public.memories
  set retrieval_count   = retrieval_count + 1,
      last_retrieved_at = now()
  where user_id = p_user and id = any(p_ids);
$$;

grant execute on function public.spine_touch_retrieved(uuid, uuid[])
  to authenticated, service_role;

-- Atomic cluster size bump on memory join
create or replace function public.spine_increment_cluster_size(
  p_cluster uuid
)
returns void
language sql
as $$
  update public.memory_clusters
  set size       = size + 1,
      updated_at = now()
  where id = p_cluster;
$$;

grant execute on function public.spine_increment_cluster_size(uuid)
  to authenticated, service_role;

-- Per-memory duplicate candidates (called by /api/capture after insert)
create or replace function public.spine_duplicates_for_memory(
  p_user      uuid,
  p_memory_id uuid,
  p_threshold double precision default 0.92,
  p_limit     int default 20
)
returns table (
  other_id   uuid,
  similarity double precision
)
language sql stable
as $$
  with target as (
    select embedding
    from public.memories
    where id = p_memory_id and user_id = p_user and deleted_at is null
    limit 1
  )
  select
    m.id as other_id,
    1 - (m.embedding <=> t.embedding) as similarity
  from public.memories m
  cross join target t
  where m.user_id = p_user
    and m.id <> p_memory_id
    and m.deleted_at is null
    and m.embedding is not null
    and 1 - (m.embedding <=> t.embedding) > p_threshold
  order by m.embedding <=> t.embedding
  limit p_limit;
$$;

grant execute on function public.spine_duplicates_for_memory(uuid, uuid, double precision, int)
  to authenticated, service_role;
