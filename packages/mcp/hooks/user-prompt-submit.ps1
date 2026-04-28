# Spine UserPromptSubmit hook — captures every user prompt as a turn row.
#
# Stdin from Claude Code: { session_id, prompt }
# Stdout: nothing.
#
# To opt turns into semantic embedding (cost: ~$0.02 per 1000 turns), set
# $env:SPINE_EMBED_TURNS = '1' before launching Claude Code.
$ErrorActionPreference = 'SilentlyContinue'
$stdin = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($stdin)) {
  exit 0
}
$stdin | & npx -y "@spine/mcp" capture-turn | Out-Null
exit 0
