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
          process.stdout.write('[spine] API key accepted.\n');
        } else if (res.status === 404) {
          process.stdout.write(
            '[spine] /ping not reachable yet — saving config anyway.\n'
          );
        } else {
          process.stdout.write(
            `[spine] API returned ${res.status} — saving config anyway.\n`
          );
        }
      } catch {
        process.stdout.write('[spine] could not reach API — saving config anyway.\n');
      }

      await writeConfig({ ...existing, mode: 'cloud', apiKey, apiBase });
    } else {
      await writeConfig({ mode: 'local' });
      process.stdout.write(
        '[spine] Local-only storage set. Memories live in ~/.spine/memories.db\n'
      );
    }

    process.stdout.write(`\nConfig written to ${CONFIG_PATH}\n\n`);
    process.stdout.write('Add this block to your Claude Code / Claude Desktop MCP settings:\n\n');
    process.stdout.write(SETTINGS_SNIPPET + '\n\n');
    process.stdout.write(
      'Then restart Claude. Spine tools (spine_capture, spine_recall, ...) will appear in the tool inspector.\n'
    );
  } finally {
    rl.close();
  }
}
