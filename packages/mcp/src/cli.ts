#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { initCommand } from './commands/init.js';
import { loginCommand } from './commands/login.js';
import { serveCommand } from './commands/serve.js';
import { hookStopCommand } from './commands/hook-stop.js';
import { injectCommand } from './commands/inject.js';
import { syncCommand } from './commands/sync.js';
import { recallRecentCommand } from './commands/recall-recent.js';
import { captureTurnCommand } from './commands/capture-turn.js';
import { sessionDigestCommand } from './commands/session-digest.js';
import { weeklyDigestCommand } from './commands/weekly-digest.js';

const USAGE = `@spine/mcp — the memory layer for your AI

Usage:
  npx @spine/mcp init                Interactive setup (auto-registers with Claude Code)
  npx @spine/mcp init --key KEY      One-line cloud setup — no prompts
  npx @spine/mcp init --local        One-line local-only setup — no prompts
  npx @spine/mcp install             Alias for init
  npx @spine/mcp sync                Ingest local ~/.claude/projects/*/memory/*.md
  npx @spine/mcp sync --dir <path>   Ingest from a custom directory
  npx @spine/mcp sync --force        Re-ingest all files (ignore already-synced check)
  npx @spine/mcp sync --dry-run      Preview what would be ingested without writing
  npx @spine/mcp serve               Start MCP server on stdio
  npx @spine/mcp hook-stop           Claude Code Stop hook (raw transcript chunking)
  npx @spine/mcp inject              Claude Code UserPromptSubmit hook (proactive injection)
  npx @spine/mcp capture-turn        Claude Code UserPromptSubmit hook (single-turn append)
  npx @spine/mcp recall-recent       Claude Code SessionStart hook (recent-context block)
  npx @spine/mcp session-digest      Claude Code Stop hook (structured end-of-session digest)
  npx @spine/mcp weekly-digest [--week=YYYY-WW] [--force]
                                     Roll up the week's session digests; outputs paste-ready markdown
  npx @spine/mcp login --key KEY     Switch to cloud mode (alias for init --key)
  npx @spine/mcp --version           Print version

Shorthand (flags passed without a subcommand run init):
  npx @spine/mcp --key KEY           Same as: npx @spine/mcp init --key KEY

Tools registered in Claude Code:
  search_memory(query)            Semantic search across all sessions
  add_memory(content, type)       Store a fact, decision, or bug fix
  add_team_memory(content, type)  Share a memory with your team
  get_timeline(from, to, type)    Chronological view of what happened
  get_context(task_description)   Inject context before starting a task
  replay_file(path)               Decision history for any file

Docs: https://spine.xxiautomate.com
`;

async function main() {
  const [, , cmd, ...rest] = process.argv;

  // Top-level flags that delegate to init (e.g. npx @spine/mcp --key <k>)
  if (!cmd || cmd.startsWith('--')) {
    const flags = cmd ? [cmd, ...rest] : rest;
    if (flags.includes('--key') || flags.includes('--local')) {
      return initCommand(flags);
    }
    if (flags.includes('-v') || flags.includes('--version')) {
      const pkg = JSON.parse(
        await readFile(new URL('../package.json', import.meta.url), 'utf8')
      ) as { version: string };
      process.stdout.write(pkg.version + '\n');
      return;
    }
    if (flags.includes('-h') || flags.includes('--help')) {
      process.stdout.write(USAGE);
      return;
    }
    // No subcommand, no flags → start MCP server (default for Claude Code)
    return serveCommand();
  }

  switch (cmd) {
    case 'init':
    case 'install':
      return initCommand(rest);
    case 'serve':
      return serveCommand();
    case 'login':
      // login --key KEY → same as init --key KEY
      return initCommand(['--key', ...rest.filter((a) => a !== '--key')]);
    case 'sync':
      return syncCommand(rest);
    case 'hook-stop':
      return hookStopCommand();
    case 'inject':
      return injectCommand();
    case 'capture-turn':
      return captureTurnCommand();
    case 'recall-recent':
      return recallRecentCommand();
    case 'session-digest':
      return sessionDigestCommand();
    case 'weekly-digest':
      return weeklyDigestCommand(rest);
    case '-v':
    case '--version': {
      const pkg = JSON.parse(
        await readFile(new URL('../package.json', import.meta.url), 'utf8')
      ) as { version: string };
      process.stdout.write(pkg.version + '\n');
      return;
    }
    case '-h':
    case '--help':
      process.stdout.write(USAGE);
      return;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${USAGE}`);
      process.exit(1);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(msg + '\n');
  process.exit(1);
});
