# Spine SessionStart hook — emits the recent-context block to stdout so
# Claude Code prepends it to the new session's system prompt.
#
# PowerShell 5.1 compatible. Wire via ~/.claude/settings.json (see
# hooks/README.md).
#
# B1 (2026-05-08): runs `recover` first to rebuild crash-orphaned digests
# from the local session buffer, then `recall-recent` for the actual
# SessionStart context block.
$ErrorActionPreference = 'SilentlyContinue'

$HookInput = [Console]::In.ReadToEnd()

# Best-effort recovery; never block on failure.
$HookInput | & npx -y spine-mcp recover *> $null
# Canonical SessionStart payload.
$HookInput | & npx -y spine-mcp recall-recent
exit 0
