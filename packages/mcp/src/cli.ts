#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { initCommand } from './commands/init.js';
import { loginCommand } from './commands/login.js';
import { serveCommand } from './commands/serve.js';

const USAGE = `xxiautomate-spine — the memory layer for your AI

Usage:
  npx xxiautomate-spine                   Start the MCP server on stdio (default)
  npx xxiautomate-spine init              Interactive setup (writes ~/.spine/config.json)
  npx xxiautomate-spine serve             Start the MCP server on stdio
  npx xxiautomate-spine login --key KEY   Switch to cloud mode
  npx xxiautomate-spine --version         Print version

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
