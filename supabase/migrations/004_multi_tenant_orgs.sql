-- Migration 004: multi-tenant workspace model.
-- Adds orgs, org_members; scopes every existing table by org_id.
-- Backfills existing users into personal "default" orgs.
-- Idempotent — safe to re-run.

---------------------------------------------------------------
-- Orgs
---------------------------------------------------------------

create table if not exists public.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,                  -- e.g. "acme-corp" or "default-<user_id_prefix>"
  owner_id    uuid not null references auth.users(id) on delete cascade,
  plan        text not null default 'free', -- free | pro | team
  -- LemonSqueezy billing
  ls_customer_id      text,
  ls_subscription_id  text,
  ls_variant_id       text,
  ls_status           text,                -- active | cancelled | expired | paused
  -- onboarding
  onboarding_completed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists orgs_owner_idx on public.orgs (owner_id);
create index if not exists orgs_ls_customer_idx on public.orgs (ls_customer_id) where ls_customer_id is not null;
create index if not exists orgs_ls_sub_idx on public.orgs (ls_subscription_id) where ls_subscription_id is not null;

alter table public.orgs enable row level security;

drop policy if exists orgs_owner_all on public.orgs;
create policy orgs_owner_all on public.orgs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists orgs_member_select on public.orgs;
create policy orgs_member_select on public.orgs
  for select using (
    id in (select org_id from public.org_members where user_id = auth.uid())
  );

---------------------------------------------------------------
-- Org members
---------------------------------------------------------------

create table if not exists public.org_members (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member',  -- owner | admin | member | viewer
  joined_at  timestamptz not null default now(),
  constraint org_members_unique unique (org_id, user_id)
);

create index if not exists org_members_user_idx on public.org_members (user_id);
create index if not exists org_members_org_idx  on public.org_members (org_id);

alter table public.org_members enable row level security;

drop policy if exists org_members_member_select on public.org_members;
create policy org_members_member_select on public.org_members
  for select using (
    org_id in (select org_id from public.org_members om2 where om2.user_id = auth.uid())
  );

drop policy if exists org_members_owner_all on public.org_members;
create policy org_members_owner_all on public.org_members
  for all using (
    org_id in (select id from public.orgs where owner_id = auth.uid())
  );

---------------------------------------------------------------
-- org_id helper function (used in RLS policies below)
---------------------------------------------------------------

create or replace function public.my_org_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select org_id from public.org_members where user_id = auth.uid()
$$;

grant execute on function public.my_org_ids() to authenticated;

---------------------------------------------------------------
-- Add org_id to memories
---------------------------------------------------------------

alter table public.memories
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

create index if not exists memories_org_idx
  on public.memories (org_id, created_at desc)
  where org_id is not null and deleted_at is null;

-- Replace old RLS with org-scoped policy
drop policy if exists memories_owner_all on public.memories;

drop policy if exists memories_org_all on public.memories;
create policy memories_org_all on public.memories
  for all using (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())  -- backward compat for un-migrated rows
  )
  with check (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  );

---------------------------------------------------------------
-- Add org_id to entity_nodes
---------------------------------------------------------------

alter table public.entity_nodes
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

drop policy if exists entity_nodes_owner_all on public.entity_nodes;

drop policy if exists entity_nodes_org_all on public.entity_nodes;
create policy entity_nodes_org_all on public.entity_nodes
  for all using (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  )
  with check (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  );

---------------------------------------------------------------
-- Add org_id to entity_edges
---------------------------------------------------------------

alter table public.entity_edges
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

drop policy if exists entity_edges_owner_all on public.entity_edges;

drop policy if exists entity_edges_org_all on public.entity_edges;
create policy entity_edges_org_all on public.entity_edges
  for all using (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  )
  with check (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  );

---------------------------------------------------------------
-- Add org_id to memory_conflicts
---------------------------------------------------------------

alter table public.memory_conflicts
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

drop policy if exists conflicts_owner_all on public.memory_conflicts;

drop policy if exists conflicts_org_all on public.memory_conflicts;
create policy conflicts_org_all on public.memory_conflicts
  for all using (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  )
  with check (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  );

---------------------------------------------------------------
-- Add org_id to entity_merge_proposals
---------------------------------------------------------------

alter table public.entity_merge_proposals
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

drop policy if exists merge_proposals_owner_all on public.entity_merge_proposals;

drop policy if exists merge_proposals_org_all on public.entity_merge_proposals;
create policy merge_proposals_org_all on public.entity_merge_proposals
  for all using (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  )
  with check (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  );

---------------------------------------------------------------
-- Add org_id to digests
---------------------------------------------------------------

alter table public.digests
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

---------------------------------------------------------------
-- Profiles: add LemonSqueezy fields + default_org_id
---------------------------------------------------------------

alter table public.profiles
  add column if not exists default_org_id uuid references public.orgs(id) on delete set null;

alter table public.profiles
  add column if not exists ls_customer_id text;

-- Plan on profiles now sourced from the org's plan (denormalised for fast reads)
-- We keep the existing `plan` column and sync it from org plan via webhook.

---------------------------------------------------------------
-- RPC: ensure_default_org — idempotent org bootstrap for new users.
-- Creates a personal org and member row if the user has none.
-- Returns the org_id.
---------------------------------------------------------------

create or replace function public.spine_ensure_default_org(p_user_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_org_id uuid;
  v_email  text;
  v_name   text;
begin
  -- Check existing ownership
  select id into v_org_id
  from public.orgs
  where owner_id = p_user_id
  limit 1;

  if v_org_id is not null then
    -- Ensure member row exists
    insert into public.org_members (org_id, user_id, role)
    values (v_org_id, p_user_id, 'owner')
    on conflict (org_id, user_id) do nothing;

    -- Sync default_org_id on profile
    update public.profiles
    set default_org_id = v_org_id
    where user_id = p_user_id and (default_org_id is null or default_org_id != v_org_id);

    return v_org_id;
  end if;

  -- Get display name from auth metadata
  select raw_user_meta_data->>'name', email
  into v_name, v_email
  from auth.users
  where id = p_user_id;

  v_name := coalesce(
    nullif(trim(v_name), ''),
    nullif(split_part(v_email, '@', 1), ''),
    'Personal workspace'
  );

  -- Create org
  insert into public.orgs (name, slug, owner_id, plan)
  values (
    v_name,
    'personal-' || left(p_user_id::text, 8),
    p_user_id,
    coalesce((select plan from public.profiles where user_id = p_user_id limit 1), 'free')
  )
  on conflict (slug) do update set updated_at = now()
  returning id into v_org_id;

  -- Create member row
  insert into public.org_members (org_id, user_id, role)
  values (v_org_id, p_user_id, 'owner')
  on conflict (org_id, user_id) do nothing;

  -- Set default on profile
  insert into public.profiles (user_id, default_org_id)
  values (p_user_id, v_org_id)
  on conflict (user_id) do update set default_org_id = v_org_id;

  return v_org_id;
end;
$$;

grant execute on function public.spine_ensure_default_org(uuid) to authenticated, service_role;

---------------------------------------------------------------
-- Backfill: create default orgs for every existing user and
-- set org_id on all their existing rows.
---------------------------------------------------------------

do $$
declare
  r record;
  v_org_id uuid;
begin
  for r in (select id from auth.users) loop
    v_org_id := public.spine_ensure_default_org(r.id);

    -- Backfill memories
    update public.memories
    set org_id = v_org_id
    where user_id = r.id and org_id is null;

    -- Backfill entity_nodes
    update public.entity_nodes
    set org_id = v_org_id
    where user_id = r.id and org_id is null;

    -- Backfill entity_edges
    update public.entity_edges
    set org_id = v_org_id
    where user_id = r.id and org_id is null;

    -- Backfill memory_conflicts
    update public.memory_conflicts
    set org_id = v_org_id
    where user_id = r.id and org_id is null;

    -- Backfill entity_merge_proposals
    update public.entity_merge_proposals
    set org_id = v_org_id
    where user_id = r.id and org_id is null;
  end loop;
end;
$$;

---------------------------------------------------------------
-- Audit log for Team plan — tracks policy changes, member adds/removes.
---------------------------------------------------------------

create table if not exists public.org_audit_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  actor_id    uuid not null references auth.users(id) on delete cascade,
  action      text not null,  -- member.invite | member.join | member.remove | policy.change | plan.upgrade
  target_id   uuid,           -- user_id or memory_id being acted on
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists org_audit_log_org_idx on public.org_audit_log (org_id, created_at desc);

alter table public.org_audit_log enable row level security;

drop policy if exists org_audit_log_member_select on public.org_audit_log;
create policy org_audit_log_member_select on public.org_audit_log
  for select using (org_id = any(public.my_org_ids()));
