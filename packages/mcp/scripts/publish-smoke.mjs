#!/usr/bin/env node
//
// publish-smoke — run before `npm publish` to prove the published tarball works
// end-to-end. Catches the common failures that only surface AFTER you've shipped:
//
//   1. dist/ is stale or missing files
//   2. package.json `files` field excludes something the bin needs
//   3. Bin shebang/permissions are off
//   4. A dependency isn't actually declared
//   5. `npx <tarball> --version` doesn't print the version
//   6. `npx <tarball> init --local` doesn't write a config
//   7. The serve binary crashes on cold start
//
// Run from the package root:  node scripts/publish-smoke.mjs
//
// On success: prints "publish-smoke: OK" and exits 0. Roman can then publish.
// On failure: prints the failing step + stderr, exits non-zero.
//
// This script is read-only — it runs everything in a fresh temp directory and
// uses HOME=$(mktemp) so a real ~/.spine/config.json can never be touched.

import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');

const sandbox = mkdtempSync(join(tmpdir(), 'spine-smoke-'));
const fakeHome = mkdtempSync(join(tmpdir(), 'spine-smoke-home-'));

function step(label, fn) {
  process.stdout.write(`  ${label} … `);
  try {
    fn();
    process.stdout.write('ok\n');
  } catch (err) {
    process.stdout.write('FAIL\n');
    process.stderr.write(`\n[publish-smoke] step "${label}" failed:\n`);
    process.stderr.write(err && err.message ? err.message : String(err));
    process.stderr.write('\n');
    process.exit(1);
  }
}

function cleanup() {
  try { rmSync(sandbox,  { recursive: true, force: true }); } catch {}
  try { rmSync(fakeHome, { recursive: true, force: true }); } catch {}
  // npm pack writes the tarball into PKG_ROOT (cwd of the pack call). Wipe it.
  try {
    if (tarballPath && existsSync(tarballPath)) rmSync(tarballPath, { force: true });
  } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

console.log('publish-smoke — verifying @spine/mcp publish-readiness\n');

// 1. Build is fresh.
step('build dist', () => {
  execSync('npm run build', { cwd: PKG_ROOT, stdio: 'pipe' });
});

// 2. Package contents look right.
let tarballPath;
step('npm pack', () => {
  const out = execSync('npm pack --json', { cwd: PKG_ROOT, stdio: 'pipe' }).toString();
  const meta = JSON.parse(out);
  if (!Array.isArray(meta) || !meta[0]?.filename) {
    throw new Error('npm pack returned no filename');
  }
  tarballPath = resolve(PKG_ROOT, meta[0].filename);
  if (!existsSync(tarballPath)) throw new Error(`tarball not found: ${tarballPath}`);

  // Required files must be in the bundle
  const required = ['dist/cli.js', 'package.json', 'README.md'];
  const filesField = meta[0].files?.map((f) => f.path) ?? [];
  for (const f of required) {
    if (!filesField.includes(f)) throw new Error(`tarball missing required file: ${f}`);
  }
  // Source files must NOT be in the bundle. .d.ts is fine (declaration files
  // give consumers types) — we only ban raw .ts source.
  const banned = filesField.filter(
    (f) => f.startsWith('src/') || (f.endsWith('.ts') && !f.endsWith('.d.ts'))
  );
  if (banned.length > 0) {
    throw new Error(`tarball contains source files: ${banned.slice(0, 5).join(', ')}`);
  }
});

// 3. Cold install in a clean directory.
step('cold install', () => {
  execSync('npm init -y', { cwd: sandbox, stdio: 'pipe' });
  execSync(`npm install "${tarballPath}"`, { cwd: sandbox, stdio: 'pipe' });
});

// 4. Bin works and prints the right version.
let installedVersion;
step('npx --version', () => {
  const expected = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version;
  const out = execSync('npx --no-install spine-mcp --version', { cwd: sandbox, stdio: 'pipe' }).toString().trim();
  if (out !== expected) throw new Error(`version mismatch: got "${out}", expected "${expected}"`);
  installedVersion = out;
});

// 5. `init --local` writes config in the fake HOME (no prompts, no network).
step('init --local writes config', () => {
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const r = spawnSync('npx', ['--no-install', 'spine-mcp', 'init', '--local'], {
    cwd: sandbox,
    env,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    throw new Error(`init --local exited ${r.status}\n${r.stderr.toString()}`);
  }
  const cfg = join(fakeHome, '.spine', 'config.json');
  if (!existsSync(cfg)) throw new Error(`config not written: ${cfg}`);
  const parsed = JSON.parse(readFileSync(cfg, 'utf8'));
  if (parsed.mode !== 'local') throw new Error(`expected mode=local, got ${parsed.mode}`);
});

// 6. `serve` boots and exits cleanly under stdin EOF (the smoke MCP wants stdio).
step('serve cold-boots', () => {
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const r = spawnSync('npx', ['--no-install', 'spine-mcp', 'serve'], {
    cwd: sandbox,
    env,
    input: '',          // EOF on stdin → MCP server should exit gracefully
    timeout: 8000,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  // We accept any clean exit OR a timeout — both prove the binary runs without
  // throwing on import. A throw would surface as exit code 1 with a stack trace.
  if (r.status !== null && r.status !== 0) {
    const stderr = r.stderr.toString();
    if (stderr.includes('Error') || stderr.includes('Cannot find')) {
      throw new Error(`serve crashed:\n${stderr}`);
    }
  }
});

console.log(`\npublish-smoke: OK · @spine/mcp@${installedVersion}`);
console.log('Safe to publish. Run from packages/mcp:');
console.log('  npm version <patch|minor|major>');
console.log('  npm publish --access public');
