// Bundles each MV3 entry point into dist/, copies static assets (manifest,
// HTML, CSS, icons). Pass --watch for an incremental rebuild loop.

import { build, context } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const WATCH = process.argv.includes('--watch');

const ENTRIES = {
  background: join(ROOT, 'src/background.ts'),
  'content-claude': join(ROOT, 'src/content-claude.ts'),
  'content-chatgpt': join(ROOT, 'src/content-chatgpt.ts'),
  'content-gemini': join(ROOT, 'src/content-gemini.ts'),
  'content-v0': join(ROOT, 'src/content-v0.ts'),
  'content-cursor': join(ROOT, 'src/content-cursor.ts'),
  'content-codeium': join(ROOT, 'src/content-codeium.ts'),
  'content-hygiene': join(ROOT, 'src/content-hygiene.ts'),
  options: join(ROOT, 'src/options/options.ts'),
  popup: join(ROOT, 'src/popup/popup.ts'),
};

const STATIC_FILES = [
  ['manifest.json', 'manifest.json'],
  ['src/options/options.html', 'options.html'],
  ['src/options/options.css', 'options.css'],
  ['src/popup/popup.html', 'popup.html'],
  ['src/popup/popup.css', 'popup.css'],
];

const STATIC_DIRS = [['icons', 'icons']];

async function clean() {
  if (existsSync(DIST)) await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
}

async function copyStatic() {
  for (const [from, to] of STATIC_FILES) {
    const src = join(ROOT, from);
    if (!existsSync(src)) continue;
    const buf = await readFile(src);
    await writeFile(join(DIST, to), buf);
  }
  for (const [from, to] of STATIC_DIRS) {
    const src = join(ROOT, from);
    if (!existsSync(src)) continue;
    await cp(src, join(DIST, to), { recursive: true });
  }
}

const sharedOptions = {
  bundle: true,
  format: 'esm',
  target: ['chrome116'],
  platform: 'browser',
  sourcemap: WATCH ? 'inline' : false,
  minify: !WATCH,
  logLevel: 'info',
};

async function buildAll() {
  await clean();
  await copyStatic();

  if (WATCH) {
    const ctxs = await Promise.all(
      Object.entries(ENTRIES).map(([name, entry]) =>
        context({
          ...sharedOptions,
          entryPoints: [entry],
          outfile: join(DIST, `${name}.js`),
        })
      )
    );
    await Promise.all(ctxs.map((c) => c.watch()));
    console.log('[spine-extension] watching for changes...');
  } else {
    await Promise.all(
      Object.entries(ENTRIES).map(([name, entry]) =>
        build({
          ...sharedOptions,
          entryPoints: [entry],
          outfile: join(DIST, `${name}.js`),
        })
      )
    );
    console.log('[spine-extension] built dist/');
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
