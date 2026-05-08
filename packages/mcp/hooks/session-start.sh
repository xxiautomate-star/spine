#!/usr/bin/env bash
# Spine SessionStart hook — emits the recent-context block to stdout so
# Claude Code prepends it to the new session's system prompt.
#
# Wire this into ~/.claude/settings.json (see hooks/README.md).
# Cost: zero — recall-recent is a read-only call against your existing
# memories. No OpenAI calls are made by this hook.
#
# B1 (2026-05-08): we also run `recover` first, with stdin tee'd in so the
# command can read the current session_id and skip it when scanning the
# buffer. recover is best-effort and silent on success — its output goes
# to stderr only when it actually rebuilds something, so the recall-recent
# block remains the canonical SessionStart payload.
set -e

# Tee stdin: recover reads the hook payload (for current_session_id),
# recall-recent doesn't read stdin so the duplicate read is harmless.
HOOK_INPUT="$(cat)"
echo "$HOOK_INPUT" | npx -y spine-mcp recover >/dev/null 2>&1 || true
echo "$HOOK_INPUT" | npx -y spine-mcp recall-recent
