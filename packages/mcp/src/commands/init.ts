import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  CONFIG_PATH,
  DEFAULT_API_BASE,
  readConfig,
  writeConfig,
} from '../config.js';

// ── Claude Code settings path (global, not per-project) ───────────────────────
const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

// The npm-published package is `spine-mcp` (no @ prefix). The pre-publish
// internal name was `@spine/mcp`; settings written by older builds still
// reference it. registerWithClaudeCode() detects + rewrites those.
const PKG_NAME = 'spine-mcp';
const LEGACY_PKG_NAMES = ['@spine/mcp'];

const MCP_SERVER_ENTRY = {
  command: 'npx',
  args: ['-y', PKG_NAME, 'serve'],
};

const STOP_HOOK_ENTRY = {
  matcher: '',
  hooks: [{ type: 'command', command: `npx ${PKG_NAME} hook-stop` }],
};

const INJECT_HOOK_ENTRY = {
  matcher: '',
  hooks: [{ type: 'command', command: `npx ${PKG_NAME} inject` }],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

type RegistrationResult = 'written' | 'already' | 'failed';

/**
 * Merge Spine into ~/.claude/settings.json.
 * Adds mcpServers.spine and the Stop hook without overwriting anything else.
 */
/**
 * Rewrite a hook command string from `@spine/mcp ...` to `spine-mcp ...`
 * (or any other legacy → current name). Returns the rewritten command and
 * a boolean indicating whether anything changed.
 */
function migratePkgName(cmd: string): { command: string; changed: boolean } {
  let out = cmd;
  let changed = false;
  for (const legacy of LEGACY_PKG_NAMES) {
    if (out.includes(legacy)) {
      out = out.split(legacy).join(PKG_NAME);
      changed = true;
    }
  }
  return { command: out, changed };
}

async function registerWithClaudeCode(): Promise<RegistrationResult> {
  try {
    const settings = await readJson<Record<string, unknown>>(CLAUDE_SETTINGS_PATH, {});
    let changed = false;

    // ── MCP server ──────────────────────────────────────────────────────────
    const mcpServers = (settings.mcpServers as Record<string, unknown> | undefined) ?? {};
    const existingSpine = mcpServers['spine'] as
      | { command?: string; args?: string[] }
      | undefined;

    if (!existingSpine) {
      mcpServers['spine'] = MCP_SERVER_ENTRY;
      settings.mcpServers = mcpServers;
      changed = true;
    } else if (Array.isArray(existingSpine.args)) {
      // Legacy installs registered `@spine/mcp` here. Rewrite in place so
      // Claude Code finds the published `spine-mcp` package on next launch.
      const newArgs = existingSpine.args.map((a) =>
        typeof a === 'string' && LEGACY_PKG_NAMES.includes(a) ? PKG_NAME : a
      );
      const argsChanged = newArgs.some((a, i) => a !== existingSpine.args![i]);
      if (argsChanged) {
        existingSpine.args = newArgs;
        mcpServers['spine'] = existingSpine;
        settings.mcpServers = mcpServers;
        changed = true;
      }
    }

    // ── Hooks (Stop + UserPromptSubmit) ─────────────────────────────────────
    const hooks = (settings.hooks as Record<string, unknown> | undefined) ?? {};

    type HookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };

    const ensureHook = (
      bucket: 'Stop' | 'UserPromptSubmit',
      identifierFragment: string,
      entryToAdd: typeof STOP_HOOK_ENTRY | typeof INJECT_HOOK_ENTRY
    ): boolean => {
      const arr = (Array.isArray(hooks[bucket]) ? hooks[bucket] : []) as HookEntry[];
      let touched = false;

      // Step 1: rewrite legacy package names in any existing entry.
      for (const entry of arr) {
        if (!entry?.hooks) continue;
        for (const ih of entry.hooks) {
          if (typeof ih.command === 'string') {
            const { command, changed: rewritten } = migratePkgName(ih.command);
            if (rewritten) {
              ih.command = command;
              touched = true;
            }
          }
        }
      }

      // Step 2: only append a fresh entry if no Spine hook is already there.
      const alreadyHooked = arr.some((entry) =>
        entry?.hooks?.some(
          (ih) =>
            typeof ih.command === 'string' && ih.command.includes(identifierFragment)
        )
      );
      if (!alreadyHooked) {
        arr.push(entryToAdd);
        touched = true;
      }

      if (touched) {
        hooks[bucket] = arr;
        settings.hooks = hooks;
      }
      return touched;
    };

    if (ensureHook('Stop', 'hook-stop', STOP_HOOK_ENTRY)) changed = true;
    if (ensureHook('UserPromptSubmit', 'inject', INJECT_HOOK_ENTRY)) changed = true;

    if (!changed) return 'already';
    await writeJson(CLAUDE_SETTINGS_PATH, settings);
    return 'written';
  } catch {
    return 'failed';
  }
}

async function verifyApiKey(apiBase: string, apiKey: string): Promise<'ok' | 'rejected' | 'unreachable'> {
  try {
    const res = await fetch(`${apiBase}/ping`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return 'ok';
    if (res.status === 401 || res.status === 403) return 'rejected';
    return 'ok'; // 404 etc — API exists, key format accepted
  } catch {
    return 'unreachable';
  }
}

function printLine(s: string) { process.stdout.write(s + '\n'); }
function ok(s: string)  { printLine('\u2713 ' + s); }
function info(s: string) { printLine('  ' + s); }
function warn(s: string) { printLine('\u26a0 ' + s); }
function head(s: string) { printLine('\n' + s); }

// ── Main ──────────────────────────────────────────────────────────────────────

export async function initCommand(args: string[] = []): Promise<void> {
  // Parse flags
  const keyFlagIdx = args.indexOf('--key');
  const apiKeyFlag  = keyFlagIdx !== -1 ? (args[keyFlagIdx + 1] ?? '') : undefined;
  const localFlag   = args.includes('--local');

  head('Spine — setup\n─────────────');

  // ── Spine config (~/.spine/config.json) ──────────────────────────────────
  const existing = await readConfig();

  if (apiKeyFlag !== undefined) {
    // Non-interactive: --key provided
    if (!apiKeyFlag) {
      process.stderr.write('Error: --key requires an API key value.\n');
      process.exit(1);
    }
    info(`Verifying API key against ${DEFAULT_API_BASE} …`);
    const status = await verifyApiKey(DEFAULT_API_BASE, apiKeyFlag);
    if (status === 'rejected') {
      process.stderr.write('Error: API key was rejected (401/403). Check your key at spine.xxiautomate.com\n');
      process.exit(1);
    }
    if (status === 'unreachable') {
      warn('Could not reach Spine API — saving config anyway.');
    } else {
      ok('API key verified');
    }
    await writeConfig({ ...existing, mode: 'cloud', apiKey: apiKeyFlag, apiBase: DEFAULT_API_BASE });
    ok(`Config written → ${CONFIG_PATH}`);

  } else if (localFlag) {
    await writeConfig({ mode: 'local' });
    ok(`Local mode set. Memories → ~/.spine/memories.db`);

  } else {
    // Interactive
    const rl = createInterface({ input, output });
    try {
      const answer = (
        await rl.question('\nStorage mode — [L]ocal-only or [c]loud sync? (L/c): ')
      ).trim().toLowerCase();

      if (answer === 'c' || answer === 'cloud') {
        const apiKey = (await rl.question('Paste your Spine API key: ')).trim();
        if (!apiKey) {
          process.stderr.write('Error: API key is required for cloud mode.\n');
          process.exit(1);
        }
        info('Verifying …');
        const status = await verifyApiKey(DEFAULT_API_BASE, apiKey);
        if (status === 'rejected') {
          process.stderr.write('Error: API key was rejected. Check your key at spine.xxiautomate.com\n');
          process.exit(1);
        }
        if (status === 'unreachable') warn('Could not reach Spine API — saving config anyway.');
        else ok('API key verified');

        await writeConfig({ ...existing, mode: 'cloud', apiKey, apiBase: DEFAULT_API_BASE });
        ok(`Config written → ${CONFIG_PATH}`);
      } else {
        await writeConfig({ mode: 'local' });
        ok('Local mode set. Memories → ~/.spine/memories.db');
      }
    } finally {
      rl.close();
    }
  }

  // ── Register with Claude Code (~/.claude/settings.json) ──────────────────
  head('Registering with Claude Code …');
  const regResult = await registerWithClaudeCode();
  if (regResult === 'written') {
    ok(`MCP server registered  → ${CLAUDE_SETTINGS_PATH}`);
    ok('Stop hook registered   → sessions captured automatically');
    ok('Inject hook registered → relevant memories injected before each prompt');
  } else if (regResult === 'already') {
    ok('Already registered in ~/.claude/settings.json');
  } else {
    warn(`Could not write to ${CLAUDE_SETTINGS_PATH}`);
    info('Add this manually to ~/.claude/settings.json:');
    info('');
    info('  "mcpServers": {');
    info(`    "spine": { "command": "npx", "args": ["-y", "${PKG_NAME}", "serve"] }`);
    info('  },');
    info('  "hooks": {');
    info('    "Stop": [{ "matcher": "", "hooks": [{ "type": "command",');
    info(`      "command": "npx ${PKG_NAME} hook-stop" }] }]`);
    info('  }');
    info('');
  }

  // ── Tools available ───────────────────────────────────────────────────────
  head('Setup complete. Restart Claude Code, then try:');
  info('  search_memory("auth bug")          — find past decisions');
  info('  get_context("task description")    — inject context before a task');
  info('  replay_file("src/lib/auth.ts")     — full decision history for a file');
  info('  add_memory("we use postgres 15")   — store a fact permanently');
  info('');
  info('Docs → https://spine.xxiautomate.com');
  info('');
}
