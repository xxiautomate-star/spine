#!/usr/bin/env bash
# Spine Stop / SessionEnd hook — writes a structured session digest.
#
# Stdin from Claude Code: { session_id, transcript_path, stop_hook_active }
# Stdout: nothing.
#
# The digest captures files touched + commits made (best-effort heuristics).
# For richer digests, prompt Claude during the session to call
# spine_session_digest with hand-crafted decisions / state / open_threads.
set -e
exec npx -y @spine/mcp session-digest
