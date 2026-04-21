#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { initCommand } from './commands/init.js';
import { loginCommand } from './commands/login.js';
import { serveCommand } from './commands/serve.js';
import { hookStopCommand } from './commands/hook-stop.js';

const USAGE = `@spine/mcp — the memory layer for your AI

Usage:
  npx @spine/mcp                     Start the MCP server on stdio (default)
  npx @spine/mcp init                Interactive setup (writes ~/.spine/config.json)
  npx @spine/mcp serve               Start the MCP server on stdio
  npx @spine/mcp hook-stop           Claude Code Stop hook — auto-ingest session summary
  npx @spine/mcp login --key KEY     Switch to cloud mode
  npx @spine/mcp --version           Print version

Tools exposed: search_memory · add_memory · get_timeline · get_context
Docs: https://spine.xxiautomate.com
`;

async function main() {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case 'init':
      return initCommand();
    case 'serve':
      return serveCommand();
    case 'login':
      return loginCommand(rest);
    case 'hook-stop':
      return hookStopCommand();
    case '-v':
    case '--version': {
      const pkg = JSON.parse(
        await readFile(new URL('../package.json', import.meta.url), 'utf8')
      ) as { version: string };
      process.stdout.write(pkg.version + '\n');
      return;
    }
    case undefined:
      return serveCommand();
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
