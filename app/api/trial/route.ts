import { NextResponse, type NextRequest } from 'next/server';
import { withCors, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return preflight();
}

// Returns the MCP config snippet for a trial installation.
// The trial key is a static demo key pre-seeded in the demo Supabase account.
// On request access conversion, the dashboard generates a real key.
export async function GET(_req: NextRequest) {
  const trialKey = process.env.SPINE_TRIAL_KEY ?? 'spine_live_DEMO_KEY_REPLACE_WITH_YOURS';
  const endpoint = process.env.NEXT_PUBLIC_APP_URL ?? 'https://spine.xxiautomate.com';

  const mcpJson = {
    mcpServers: {
      spine: {
        command: 'npx',
        args: ['-y', '@spine/mcp'],
        env: {
          SPINE_API_KEY: trialKey,
          SPINE_ENDPOINT: endpoint,
        },
      },
    },
  };

  return withCors(
    NextResponse.json({
      key: trialKey,
      endpoint,
      mcpJson,
      mcpJsonString: JSON.stringify(mcpJson, null, 2),
      instructions: [
        'Paste the config into ~/.claude/mcp.json (Claude Code) or your Claude Desktop config',
        'Restart Claude Code / Claude Desktop',
        'Ask Claude: "What do you know about me?" — Spine will reply with your memories',
      ],
    })
  );
}
