# Spine SessionStart hook — emits the recent-context block to stdout so
# Claude Code prepends it to the new session's system prompt.
#
# PowerShell 5.1 compatible. Wire via ~/.claude/settings.json (see
# hooks/README.md).
$ErrorActionPreference = 'SilentlyContinue'
& npx -y "@spine/mcp" recall-recent
exit 0
