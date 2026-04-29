-- Migration 020: Conversation capture (claude-mem replacement).
--
-- Adds the columns needed to store individual conversation turns and
-- end-of-session digests directly on the memories table — no new table,
-- so all existing infrastructure (RLS, HNSW vector index, BM25 tsvector,
-- audit log, cluster assignment) applies for free.
--
-- Storage shape:
--   - kind = 'turn'   → one row per user/assistant/tool turn during a session
--   - kind = 'digest' → one row per session, written at end-of-session,
--                       JSON-bodied (decisions, state, open_threads, ...)
--   - kind = null     → existing memories (backwards compatible)
--
-- Embeddings policy (handled at the /api/capture layer, not this migration):
--   - turns default to embedding=null (skip OpenAI cost on chatty users)
--   - digests always embed (low volume, high signal)
--   - power users can opt turns into embeddings via embed_turns=true
--
-- Append-only is enforced at the API surface — there is no public
-- delete_turn / update_turn route. The existing forget endpoint stays for
-- rare manual deletions only.
--
-- Idempotent. Safe to re-run.

-- ── Columns ──────────────────────────────────────────────────────────────────

alter table public.memories
  add column if not exists session_id    text,
  add column if not exists kind          text,
  add column if not exists tool_name     text,
  add column if not exists files_touched text[];

-- 'turn' or 'digest' — we leave kind nullable so existing rows are
-- untouched. New conversation rows must populate it.
alter table public.memories
  drop constraint if exists memories_kind_check;
alter table public.memories
  add constraint memories_kind_check
  check (kind is null or kind in ('turn', 'digest'));

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Per-session timeline lookup. Partial so the index stays tiny — only
-- conversation rows participate, the millions of pre-existing memories
-- without a session_id are skipped entirely.
create index if not exists memories_session_idx
  on public.memories (user_id, session_id, created_at desc)
  where session_id is not null and deleted_at is null;

-- Recent-digest lookup powers /api/recall/recent. Tiny index — there's
-- one digest per session, not per turn.
create index if not exists memories_digest_idx
  on public.memories (user_id, created_at desc)
  where kind = 'digest' and deleted_at is null;

-- ── Comments ─────────────────────────────────────────────────────────────────

comment on column public.memories.session_id is
  'Stable per-CLI-session id when this row was captured by the conversation hooks. Null for non-conversation memories.';
comment on column public.memories.kind is
  'Conversation row kind: turn (single message), digest (end-of-session JSON), or null (legacy memory).';
comment on column public.memories.tool_name is
  'For role=tool turn rows, the name of the tool invoked (e.g. Read, Bash).';
comment on column public.memories.files_touched is
  'File paths touched by the turn — pulled from tool args when relevant. Lets replay_file find turns without parsing.';
