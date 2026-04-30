#!/usr/bin/env node
//
// capture-launch-film — converts the self-contained launch-film HTML files
// into MP4 + WebM + poster.jpg for embedding on spine.xxiautomate.com.
//
// Source files (DO NOT MODIFY):
//   marketing/launch-films/spine-v2/exports/16x9.html
//   marketing/launch-films/spine-v2/exports/9x16-socials-v2-with-opener.html
//
// Outputs (committed):
//   saas/spine/public/launch-film/16x9.mp4
//   saas/spine/public/launch-film/16x9.webm
//   saas/spine/public/launch-film/16x9-poster.jpg
//   saas/spine/public/launch-film/9x16.mp4
//   saas/spine/public/launch-film/9x16.webm
//   saas/spine/public/launch-film/9x16-poster.jpg
//
// Pipeline:
//   1. Playwright Chromium loads file:// URL at exact aspect dimensions
//   2. Wait for bundle to unpack + React to mount + Stage to start ticking
//   3. Hide the .aspect-picker UI overlay
//   4. recordVideo runs for FILM_DURATION + buffer; the result lands as a webm
//   5. ffmpeg transcodes the raw webm into:
//        - <name>.mp4   (h264, faststart, target ~3MB at 720p / scaled vertical)
//        - <name>.webm  (vp9, deadline=good, target ~3MB)
//        - <name>-poster.jpg (frame at 0.5s, q=85)
//
// Why two source codecs in the output:
//   Safari and iOS only reliably play h264 MP4.
//   Chrome / Firefox prefer VP9 WebM (smaller at the same quality).
//   <video> tag picks the first <source> the browser supports.
//
// Run:
//   node saas/spine/scripts/capture-launch-film.mjs
// Optional flags:
//   --only=16x9       capture only the 16x9 source
//   --only=9x16       capture only the 9x16 source
//   --duration=45     override film duration (seconds)

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readdirSync, statSync, renameSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SOURCE_DIR = join(REPO_ROOT, 'marketing', 'launch-films', 'spine-v2', 'exports');
const OUT_DIR = resolve(__dirname, '..', 'public', 'launch-film');
const FILM_DURATION_SEC = parseFloat(argFor('--duration')) || 45;
const LEAD_IN_SEC = 3.0; // bundler unpack + aspect-picker flash window
const RECORD_SEC = FILM_DURATION_SEC + LEAD_IN_SEC;
const ONLY = argFor('--only');

// The Stage component reserves 44px at the bottom of the viewport for its
// PlaybackBar. We oversize the viewport by that amount so the inner canvas
// renders at 1:1 (no scale-down + black margins), then crop the bottom 44
// rows in ffmpeg. canvas_w/h are the real film dimensions; viewport_h
// includes the 44px bar zone we'll discard.
const STAGE_BAR_H = 44;

const SOURCES = [
  {
    key: '16x9',
    src: 'wide',
    file: '16x9.html',
    canvas_w: 1920,
    canvas_h: 1080,
    out_w: 1280,
    out_h: 720,
    bitrate: '2200k',
  },
  {
    key: '9x16',
    src: 'vertical',
    file: '9x16-socials-v2-with-opener.html',
    canvas_w: 1080,
    canvas_h: 1920,
    out_w: 720,
    out_h: 1280,
    bitrate: '2000k',
  },
].filter((s) => !ONLY || s.key === ONLY);

function argFor(flag) {
  const found = process.argv.find((a) => a.startsWith(flag + '='));
  return found ? found.split('=')[1] : '';
}

function log(msg) {
  process.stdout.write(`[capture] ${msg}\n`);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const cfg of SOURCES) {
  const srcPath = join(SOURCE_DIR, cfg.file);
  if (!existsSync(srcPath)) {
    throw new Error(`source missing: ${srcPath}`);
  }

  // Viewport = canvas dims + space for Stage's PlaybackBar at the bottom.
  // We crop the bottom STAGE_BAR_H rows in ffmpeg below.
  const viewport_w = cfg.canvas_w;
  const viewport_h = cfg.canvas_h + STAGE_BAR_H;

  log(`${cfg.key} :: launching Chromium @ ${viewport_w}x${viewport_h} (canvas ${cfg.canvas_w}x${cfg.canvas_h} + ${STAGE_BAR_H}px chrome)`);

  const tmpVideoDir = join(tmpdir(), `spine-film-${cfg.key}-${Date.now()}`);
  mkdirSync(tmpVideoDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      // Lock the wall-clock so the film's animations don't drop frames under
      // CPU pressure. Chromium's compositor still ticks, the CPU just budgets
      // every frame more generously.
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: viewport_w, height: viewport_h },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: tmpVideoDir,
      size: { width: viewport_w, height: viewport_h },
    },
  });

  const page = await context.newPage();

  // Pre-set the aspect localStorage so the film opens in the correct mode
  // immediately (the source HTML reads localStorage on init).
  await page.addInitScript((aspect) => {
    try {
      window.localStorage.setItem('xxi-film:aspect', aspect);
    } catch {
      /* not all contexts allow ls; the URL hash fallback handles this */
    }
  }, cfg.src);

  await page.goto(pathToFileURL(srcPath).toString(), { waitUntil: 'load' });

  // Wait for the bundler to unpack and React to mount.
  log(`${cfg.key} :: waiting for #root to mount`);
  await page.waitForFunction(
    () => {
      const root = document.querySelector('#root');
      if (!root) return false;
      // The Stage component renders a wrapper element. We wait until #root
      // has at least one child (React tree mounted) AND the bundler loading
      // banner is gone.
      return root.children.length > 0 && !document.querySelector('#__bundler_loading');
    },
    { timeout: 30_000 }
  );

  // Strip the Stage chrome that doesn't belong on a landing-page embed.
  // Done via DOM mutation rather than just CSS — the bundled HTML uses a
  // self-extract pattern that may rewrite the document, so a CSS rule
  // injected before unpack can be lost. Belt + braces here.
  await page.evaluate(() => {
    // 1. The aspect picker (top-right `.aspect-picker`) — kill it.
    document.querySelector('.aspect-picker')?.remove();

    // 2. Stage's PlaybackBar — last child of #root's flex-column wrapper.
    //    We can't target by class (Stage uses inline styles only) so we
    //    fall back to "the wrapper has 2 children, the second one is the
    //    bar". Verified via scripts/inspect-launch-film.mjs.
    const stageWrapper = document.querySelector('#root > div');
    if (stageWrapper && stageWrapper.children.length >= 2) {
      stageWrapper.lastElementChild?.remove();
    }

    // 3. Belt-and-braces CSS in case Stage re-renders the bar on resize,
    //    plus background overrides so the small framing margin around the
    //    canvas doesn't show as Stage's hardcoded `#0a0a0a` (a dark band
    //    bleeds at the top of the recording otherwise). Body's bg is the
    //    intended film backdrop (#F4EFE6 cream); we make Stage transparent
    //    so the body bleeds through.
    const style = document.createElement('style');
    style.textContent =
      '.aspect-picker { display: none !important; }' +
      // Drop the canvas's outer drop-shadow (designed for hosted preview;
      // visually wrong against a landing-page hero background).
      '#root > div > div > div { box-shadow: none !important; }' +
      // Stage outer wrapper hardcodes background:#0a0a0a inline. Override.
      '#root > div { background: transparent !important; }';
    document.head.appendChild(style);
  });

  // Give React's animation timeline 500ms after the DOM tweaks to settle on
  // its first frame — without this the recording can start mid-fade-in.
  await page.waitForTimeout(500);

  log(`${cfg.key} :: recording for ${RECORD_SEC}s (${LEAD_IN_SEC}s lead-in + ${FILM_DURATION_SEC}s film)`);
  await page.waitForTimeout(RECORD_SEC * 1000);

  await page.close();
  await context.close();
  await browser.close();

  // Playwright dropped a single .webm into tmpVideoDir.
  const recorded = readdirSync(tmpVideoDir)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, size: statSync(join(tmpVideoDir, f)).size }))
    .sort((a, b) => b.size - a.size)[0];
  if (!recorded) throw new Error(`no recording produced at ${tmpVideoDir}`);

  const rawWebm = join(tmpVideoDir, recorded.f);
  log(`${cfg.key} :: raw webm ${(recorded.size / 1e6).toFixed(2)}MB`);

  // ──────────────────────────────────────────────────────────────────────
  // Transcode raw → final MP4 (h264) + WebM (vp9) + poster JPG
  // ──────────────────────────────────────────────────────────────────────
  const outMp4 = join(OUT_DIR, `${cfg.key}.mp4`);
  const outWebm = join(OUT_DIR, `${cfg.key}.webm`);
  const outPoster = join(OUT_DIR, `${cfg.key}-poster.jpg`);

  // Crop bottom STAGE_BAR_H rows (the PlaybackBar zone), then scale.
  // Take input is viewport_w x viewport_h; we want canvas_w x canvas_h
  // anchored at top-left, then resize to out_w x out_h.
  const cropFilter = `crop=${cfg.canvas_w}:${cfg.canvas_h}:0:0`;
  const scaleFilter = `${cropFilter},scale=${cfg.out_w}:${cfg.out_h}:flags=lanczos`;

  // Trim the lead-in: recording starts at page-load and the first ~3s
  // capture the bundler unpacking + the aspect picker briefly flashing
  // before our DOM-mutation removes it. Skipping the lead-in gives us a
  // clean opening frame. The film loops in-page at exactly FILM_DURATION
  // so the recording also wraps; we capture LEAD_IN + FILM_DURATION and
  // ask ffmpeg to take exactly FILM_DURATION starting after LEAD_IN —
  // result: output 0:00 lines up with film's t=LEAD_IN and the last
  // frame of the output also lands at t=LEAD_IN of the next loop, so
  // <video loop> seam is invisible.
  const trimStart = String(LEAD_IN_SEC);
  const exactDur = String(FILM_DURATION_SEC);

  log(`${cfg.key} :: transcoding to MP4 @ ${cfg.bitrate} (trim=${trimStart}s, dur=${exactDur}s)`);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-ss', trimStart,
      '-i', rawWebm,
      '-t', exactDur,
      '-vf', scaleFilter,
      '-c:v', 'libx264',
      '-preset', 'slower',
      '-tune', 'animation',
      '-profile:v', 'high',
      '-crf', '24',
      '-maxrate', cfg.bitrate,
      '-bufsize', String(parseInt(cfg.bitrate) * 2) + 'k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      outMp4,
    ],
    { stdio: 'pipe' }
  );
  log(`${cfg.key} :: mp4 ${(statSync(outMp4).size / 1e6).toFixed(2)}MB`);

  log(`${cfg.key} :: transcoding to WebM (VP9, trim=${trimStart}s, dur=${exactDur}s)`);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-ss', trimStart,
      '-i', rawWebm,
      '-t', exactDur,
      '-vf', scaleFilter,
      '-c:v', 'libvpx-vp9',
      '-deadline', 'good',
      '-cpu-used', '2',
      '-row-mt', '1',
      '-crf', '32',
      '-b:v', cfg.bitrate,
      '-pix_fmt', 'yuv420p',
      '-an',
      outWebm,
    ],
    { stdio: 'pipe' }
  );
  log(`${cfg.key} :: webm ${(statSync(outWebm).size / 1e6).toFixed(2)}MB`);

  // Poster: 3s into the trimmed MP4 where the title card has settled
  // into a visually-rich state (typewriter mid-stream, atmosphere fully
  // faded in). 0s lands on the very first frame which can read as
  // "blank loading screen" when used as the <video poster> attribute.
  log(`${cfg.key} :: extracting poster frame at 3s`);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-ss', '3.0',
      '-i', outMp4,
      '-vframes', '1',
      '-q:v', '4',
      outPoster,
    ],
    { stdio: 'pipe' }
  );
  log(`${cfg.key} :: poster ${(statSync(outPoster).size / 1e3).toFixed(0)}KB`);

  rmSync(tmpVideoDir, { recursive: true, force: true });
}

log('done');
