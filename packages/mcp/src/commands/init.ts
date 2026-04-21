import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  CONFIG_PATH,
  DEFAULT_API_BASE,
  readConfig,
  writeConfig,
} from '../config.js';

const SETTINGS_SNIPPET = `{
  "mcpServers": {
    "spine": {
      "command": "npx",
      "args": ["-y", "@spine/mcp", "serve"]
    }
  }
}`;

const CURSOR_SNIPPET = `{
  "mcpServers": {
    "spine": {
      "command": "npx",
      "args": ["-y", "@spine/mcp", "serve"]
    }
  }
}`;

const STOP_HOOK_SNIPPET = `{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "npx @spine/mcp hook-stop"
          }
        ]
      }
    ]
  }
}`;

export async function initCommand(): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    process.stdout.write('\nSpine — setup\n─────────────\n\n');
    const existing = await readConfig();

    const answer = (
      await rl.question('Storage mode — [L]ocal-only or [c]loud sync? (L/c): ')
    )
      .trim()
      .toLowerCase();

    if (answer === 'c' || answer === 'cloud') {
      const apiKey = (await rl.question('Paste your Spine API key: ')).trim();
      if (!apiKey) throw new Error('An API key is required for cloud mode.');
      const apiBasePrompt = (
        await rl.question(`API base URL (default ${DEFAULT_API_BASE}): `)
      ).trim();
      const apiBase = apiBasePrompt || DEFAULT_API_BASE;

      try {
        const res = await fetch(`${apiBase}/ping`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.ok) {
          process.stdout.write('[spine] API key accepted \u2713\n');
        } else if (res.status === 404) {
          process.stdout.write('[spine] /ping not reachable yet \u2014 saving config anyway.\n');
        } else {
          process.stdout.write(`[spine] API returned ${res.status} \u2014 saving config anyway.\n`);
        }
      } catch {
        process.stdout.write('[spine] could not reach API \u2014 saving config anyway.\n');
      }

      await writeConfig({ ...existing, mode: 'cloud', apiKey, apiBase });
    } else {
      await writeConfig({ mode: 'local' });
      process.stdout.write('[spine] Local storage set. Memories live in ~/.spine/memories.db\n');
    }

    process.stdout.write(`\nConfig written to ${CONFIG_PATH}\n`);

    process.stdout.write('\n\u2501\u2501\u2501 Step 1 \u2014 Add the MCP server \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n');
    process.stdout.write('Claude Code \u2014 add to .claude/settings.json in your project:\n\n');
    process.stdout.write(SETTINGS_SNIPPET + '\n\n');
    process.stdout.write('Cursor (~/.cursor/mcp.json) \u00b7 Windsurf \u00b7 Continue (same schema):\n\n');
    process.stdout.write(CURSOR_SNIPPET + '\n\n');
    process.stdout.write(
      'Restart your editor. Tools that will appear:\n' +
      '  search_memory(query)           \u2014 semantic search across all sessions\n' +
      '  add_memory(content, type)      \u2014 capture a fact, decision, or bug fix\n' +
      '  get_timeline(from, to, type)   \u2014 chronological view of what happened\n' +
      '  get_context(task_description)  \u2014 inject relevant context for a task\n\n'
    );

    process.stdout.write('\u2501\u2501\u2501 Step 2 \u2014 Auto-capture (optional, recommended) \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n');
    process.stdout.write(
      'Merge this into .claude/settings.json so every session is ingested automatically.\n' +
      'Ask "what did I work on last week?" and get a real answer.\n\n'
    );
    process.stdout.write(STOP_HOOK_SNIPPET + '\n\n');
    process.stdout.write('Setup complete. Your AI now remembers.\n\n');
  } finally {
    rl.close();
  }
}
