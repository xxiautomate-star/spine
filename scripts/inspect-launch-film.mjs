// One-off DOM inspection — dumps the structure of the bundled film page
// after mount so we can identify which selectors are the player chrome
// (scrubber, timeline, controls) vs the film canvas itself.
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SRC = join(REPO_ROOT, 'marketing', 'launch-films', 'spine-v2', 'exports', '16x9.html');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

await page.addInitScript(() => {
  try { window.localStorage.setItem('xxi-film:aspect', 'wide'); } catch {}
});

await page.goto(pathToFileURL(SRC).toString(), { waitUntil: 'load' });
await page.waitForFunction(
  () => document.querySelector('#root')?.children.length > 0 &&
        !document.querySelector('#__bundler_loading'),
  { timeout: 30_000 }
);
await page.waitForTimeout(1500);

const dump = await page.evaluate(() => {
  const all = document.body.querySelectorAll('*');
  const out = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: el.className && typeof el.className === 'string' ? el.className.slice(0, 80) : '',
      id: el.id || '',
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      depth: (() => { let d=0,p=el; while (p && p !== document.body) { p = p.parentElement; d++; } return d; })(),
    });
  }
  // Sort by area desc — biggest things first
  out.sort((a, b) => (b.w * b.h) - (a.w * a.h));
  return out.slice(0, 40);
});

for (const e of dump) {
  console.log(`${'  '.repeat(Math.min(e.depth, 6))}${e.tag}.${e.cls}#${e.id}  ${e.x},${e.y} ${e.w}x${e.h}`);
}

await browser.close();
