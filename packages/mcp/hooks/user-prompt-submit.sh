#!/usr/bin/env bash
# Spine UserPromptSubmit hook — captures every user prompt as a turn row.
#
# Stdin from Claude Code: { session_id, prompt }
# Stdout: nothing (turn capture is silent — Claude Code doesn't render it).
#
# To opt turns into semantic embedding (cost: ~$0.02 per 1000 turns), set
# SPINE_EMBED_TURNS=1 in your shell or hook env.
set -e
exec npx -y @spine/mcp capture-turn
