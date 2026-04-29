# Spine Stop / SessionEnd hook — writes a structured session digest.
#
# Stdin from Claude Code: { session_id, transcript_path, stop_hook_active }
# Stdout: nothing.
#
# PowerShell 5.1 compatible.
$ErrorActionPreference = 'SilentlyContinue'
$stdin = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($stdin)) {
  exit 0
}
$stdin | & npx -y "@spine/mcp" session-digest | Out-Null
exit 0
