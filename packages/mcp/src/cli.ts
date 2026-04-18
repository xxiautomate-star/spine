#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { initCommand } from './commands/init.js';
import { loginCommand } from './commands/login.js';
import { serveCommand } from './commands/serve.js';

const USAGE = `@spine/mcp — the memory layer for your AI

Usage:
  npx @spine/mcp init                     Interactive setup (writes ~/.spine/config.json)
  npx @spine/mcp serve                    Start the MCP server on stdio
  npx @spine/mcp login --key <api_key>    Switch to cloud mode
  npx @spine/mcp --version                Print version

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
    case '-v':
    case '--version': {
      const pkg = JSON.parse(
        await readFile(new URL('../package.json', import.meta.url), 'utf8')
      ) as { version: string };
      process.stdout.write(pkg.version + '\n');
      return;
    }
    case undefined:
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
