import { DEFAULT_API_BASE, readConfig, writeConfig } from '../config.js';

export async function loginCommand(args: string[]): Promise<void> {
  const keyIdx = args.indexOf('--key');
  if (keyIdx === -1 || !args[keyIdx + 1]) {
    process.stderr.write(
      'Usage: npx @spine/mcp login --key <api_key> [--api <url>]\n'
    );
    process.exit(1);
  }
  const apiKey = args[keyIdx + 1];
  const apiIdx = args.indexOf('--api');
  const apiBase =
    apiIdx !== -1 && args[apiIdx + 1] ? args[apiIdx + 1] : DEFAULT_API_BASE;

  const existing = await readConfig();
  await writeConfig({ ...existing, mode: 'cloud', apiKey, apiBase });
  process.stdout.write(`[spine] switched to cloud mode via ${apiBase}\n`);
}
