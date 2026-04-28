#!/usr/bin/env bash
# Spine SessionStart hook — emits the recent-context block to stdout so
# Claude Code prepends it to the new session's system prompt.
#
# Wire this into ~/.claude/settings.json (see hooks/README.md).
# Cost: zero — recall-recent is a read-only call against your existing
# memories. No OpenAI calls are made by this hook.
set -e
exec npx -y @spine/mcp recall-recent
