#!/usr/bin/env node
// Records a 30-second demo of Spine recalling memories in a simulated Claude
// Code session. Produces public/demo.mp4 (and public/demo-poster.jpg).
//
// Requirements:
//   npm install -D playwright            (already in root devDeps)
//   npx playwright install chromium      (first time)
//   ffmpeg in PATH                       (for .webm → .mp4 conversion)
//
// Usage:
//   node scripts/record-demo.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const PUBLIC    = join(ROOT, 'public');
const TMP_DIR   = join(tmpdir(), 'spine-demo-recording');
const OUT_WEBM  = join(TMP_DIR, 'demo.webm');
const OUT_MP4   = join(PUBLIC, 'demo.mp4');
const OUT_POSTER = join(PUBLIC, 'demo-poster.jpg');

await mkdir(TMP_DIR, { recursive: true });
await mkdir(PUBLIC, { recursive: true });

// ── Scene HTML ─────────────────────────────────────────────────────────────
// A convincing Claude Code terminal session with Spine recall animation.
const SCENE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0d0c0a;
    font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
    font-size: 13px;
    line-height: 1.65;
    color: #e8e4dd;
    width: 1280px;
    height: 800px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  /* Top bar */
  .topbar {
    height: 42px;
    background: #1a1815;
    border-bottom: 1px solid rgba(232,228,221,0.07);
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 8px;
    flex-shrink: 0;
  }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot.red   { background: #ff5f57; }
  .dot.amber { background: #febc2e; }
  .dot.green { background: #28c840; }
  .topbar-title {
    margin: 0 auto;
    color: rgba(232,228,221,0.4);
    font-size: 12px;
    letter-spacing: 0.02em;
  }
  /* Layout */
  .workspace {
    flex: 1;
    display: flex;
    overflow: hidden;
  }
  /* Sidebar */
  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: #130f0c;
    border-right: 1px solid rgba(232,228,221,0.05);
    padding: 14px 0;
    overflow: hidden;
  }
  .sidebar-label {
    padding: 0 14px 8px;
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(232,228,221,0.25);
  }
  .sidebar-item {
    padding: 5px 14px;
    font-size: 12px;
    color: rgba(232,228,221,0.5);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sidebar-item.active {
    background: rgba(232,228,221,0.05);
    color: rgba(232,228,221,0.9);
  }
  .sidebar-item::before {
    content: '●';
    font-size: 6px;
    opacity: 0.4;
  }
  .sidebar-item.active::before { color: #e89a3c; opacity: 1; }
  /* Terminal */
  .terminal {
    flex: 1;
    padding: 20px 28px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .line {
    display: flex;
    gap: 0;
    min-height: 1.65em;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 0.25s ease, transform 0.25s ease;
  }
  .line.visible { opacity: 1; transform: translateY(0); }
  .prompt { color: #e89a3c; flex-shrink: 0; margin-right: 8px; }
  .cmd { color: #e8e4dd; }
  .dim { color: rgba(232,228,221,0.35); }
  .info { color: rgba(232,228,221,0.5); padding-left: 20px; }
  .success { color: #10b981; padding-left: 20px; }
  .spine-heading {
    color: #e89a3c;
    font-weight: bold;
    padding-left: 20px;
    margin-top: 4px;
  }
  .memory-block {
    background: rgba(232,154,60,0.06);
    border: 1px solid rgba(232,154,60,0.18);
    border-radius: 6px;
    padding: 10px 14px;
    margin: 6px 20px;
    opacity: 0;
    transition: opacity 0.4s ease;
  }
  .memory-block.visible { opacity: 1; }
  .memory-block .mem-label {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #e89a3c;
    margin-bottom: 4px;
  }
  .memory-block .mem-text {
    color: rgba(232,228,221,0.75);
    font-size: 12px;
    line-height: 1.55;
  }
  .claude-response {
    padding-left: 20px;
    color: rgba(232,228,221,0.85);
    line-height: 1.7;
    border-left: 2px solid rgba(232,154,60,0.3);
    margin-left: 2px;
    padding-left: 14px;
    margin-top: 4px;
  }
  .claude-response .highlight { color: #e89a3c; }
  /* Cursor blink */
  .cursor {
    display: inline-block;
    width: 7px;
    height: 14px;
    background: #e89a3c;
    animation: blink 1s step-end infinite;
    vertical-align: text-bottom;
  }
  @keyframes blink { 50% { opacity: 0; } }
  /* Spine badge */
  .spine-badge {
    position: fixed;
    bottom: 20px;
    right: 24px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(13,12,10,0.9);
    border: 1px solid rgba(232,154,60,0.3);
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 11px;
    color: #e89a3c;
    opacity: 0;
    transition: opacity 0.5s ease;
  }
  .spine-badge.visible { opacity: 1; }
  .spine-badge .dot-pulse {
    width: 6px; height: 6px; border-radius: 50%;
    background: #e89a3c;
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
</style>
</head>
<body>
  <div class="topbar">
    <div class="dot red"></div>
    <div class="dot amber"></div>
    <div class="dot green"></div>
    <span class="topbar-title">Claude Code — spine/app/api/recall/route.ts</span>
  </div>
  <div class="workspace">
    <div class="sidebar">
      <div class="sidebar-label">Explorer</div>
      <div class="sidebar-item">app</div>
      <div class="sidebar-item active">api / recall / route.ts</div>
      <div class="sidebar-item">lib / supabase.ts</div>
      <div class="sidebar-item">supabase / schema.sql</div>
      <div class="sidebar-label" style="margin-top:12px">Spine</div>
      <div class="sidebar-item active" style="color:#e89a3c">↑ 25 memories loaded</div>
    </div>
    <div class="terminal" id="term">
      <!-- lines injected by JS -->
    </div>
  </div>
  <div class="spine-badge" id="badge">
    <div class="dot-pulse"></div>
    Spine: 2 memories recalled
  </div>

<script>
const term = document.getElementById('term');
const badge = document.getElementById('badge');

function line(cls, html) {
  const el = document.createElement('div');
  el.className = 'line ' + cls;
  el.innerHTML = html;
  term.appendChild(el);
  return el;
}

function memBlock(label, text) {
  const el = document.createElement('div');
  el.className = 'memory-block';
  el.innerHTML = '<div class="mem-label">' + label + '</div><div class="mem-text">' + text + '</div>';
  term.appendChild(el);
  return el;
}

function show(el, delay) {
  return new Promise(r => setTimeout(() => {
    el.classList.add('visible');
    r();
  }, delay));
}

async function run() {
  await new Promise(r => setTimeout(r, 600));

  const l1 = line('', '<span class="prompt">~/spine $</span> <span class="cmd">claude</span>');
  await show(l1, 0);

  await new Promise(r => setTimeout(r, 800));
  const l2 = line('', '<span class="dim">Claude Code v1.2.1 · Model: claude-sonnet-4-6</span>');
  await show(l2, 0);

  await new Promise(r => setTimeout(r, 400));
  const l2b = line('', '<span class="success">✓ Spine MCP connected · 25 memories available</span>');
  await show(l2b, 0);

  await new Promise(r => setTimeout(r, 900));
  const l3 = line('', '<span class="prompt">  ></span> <span class="cmd">Help me optimise the latency on the recall endpoint. It\'s taking ~340ms.</span>');
  await show(l3, 0);

  await new Promise(r => setTimeout(r, 600));
  const l4 = line('', '<span class="info">Thinking · recalling relevant context…</span>');
  await show(l4, 0);

  await new Promise(r => setTimeout(r, 1200));
  const l5 = line('', '<span class="spine-heading">Spine recalled 2 memories</span>');
  await show(l5, 0);

  await new Promise(r => setTimeout(r, 300));
  const m1 = memBlock('Memory · 3 days ago · claude.ai',
    'Hybrid recall pipeline: pgvector cosine top 30 + BM25 tsvector union → Haiku 4.5 reranker on Pro tier. Free tier returns pure cosine top 5 with no rerank.');
  await show(m1, 0);

  await new Promise(r => setTimeout(r, 400));
  const m2 = memBlock('Memory · 5 days ago · chatgpt.com',
    'pgvector over Pinecone — cost matters more than managed infrastructure at this stage. HNSW with cosine ops, threshold 0.78 for cluster assignment.');
  await show(m2, 0);

  badge.classList.add('visible');

  await new Promise(r => setTimeout(r, 1000));

  const resp = document.createElement('div');
  resp.className = 'claude-response line';
  resp.innerHTML = '';
  term.appendChild(resp);
  await show(resp, 0);

  const responseText = [
    'Given your setup — <span class="highlight">HNSW with cosine ops</span> and the hybrid pipeline you described —',
    ' 340ms is almost certainly the reranker. Haiku 4.5 adds ~200ms per batch.',
    '\n\nTwo options:',
    '\n  1. <span class="highlight">Skip rerank on short queries (&lt;3 tokens)</span> — pure cosine is fast and accurate enough.',
    '\n  2. <span class="highlight">Cache the top-5 embedding results</span> per user with a 30s TTL. Most consecutive',
    '\n     queries in a session share the same top candidates.',
    '\n\nYour <span class="highlight">threshold 0.78</span> for cluster assignment is a good call — that\'s already',
    '\n filtering the long tail before it hits the reranker.',
  ];

  let i = 0;
  for (const chunk of responseText) {
    await new Promise(r => setTimeout(r, 80 + Math.random() * 60));
    resp.innerHTML += chunk;
    i++;
  }

  await new Promise(r => setTimeout(r, 800));
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  resp.appendChild(cursor);
}

run();
</script>
</body>
</html>`;

// ── Record ─────────────────────────────────────────────────────────────────
console.log('Launching browser for recording…');
const context = await chromium.launchPersistentContext(
  join(tmpdir(), 'spine-demo-profile'),
  {
    headless: false,
    viewport: { width: 1280, height: 800 },
    recordVideo: {
      dir: TMP_DIR,
      size: { width: 1280, height: 800 },
    },
    args: ['--no-first-run', '--no-default-browser-check'],
  }
);

const page = await context.newPage();
await page.setViewportSize({ width: 1280, height: 800 });
await page.setContent(SCENE_HTML, { waitUntil: 'domcontentloaded' });

console.log('Recording 32 seconds of animation…');
await page.waitForTimeout(32_000);

// Capture poster frame at 4s (after terminal initialises, before recall shows)
await page.screenshot({ path: OUT_POSTER });
console.log(`Poster saved → ${OUT_POSTER}`);

await context.close(); // flushes the .webm

// Find the recorded .webm
const { readdirSync } = await import('node:fs');
const webms = readdirSync(TMP_DIR).filter((f) => f.endsWith('.webm'));
if (!webms.length) {
  console.error('No .webm found in tmp dir. Recording may have failed.');
  process.exit(1);
}
const srcWebm = join(TMP_DIR, webms[webms.length - 1]);
console.log(`Recorded: ${srcWebm}`);

// ── Convert to mp4 ─────────────────────────────────────────────────────────
const hasFfmpeg = await execAsync('ffmpeg -version').then(() => true).catch(() => false);

if (hasFfmpeg) {
  console.log('Converting .webm → .mp4 with ffmpeg…');
  await execAsync(
    `ffmpeg -y -i "${srcWebm}" -c:v libx264 -preset fast -crf 23 -movflags +faststart "${OUT_MP4}"`
  );
  console.log(`✓ Video saved → ${OUT_MP4}`);
} else {
  // Copy the webm to public/ as fallback (browsers can play webm too)
  const { copyFile } = await import('node:fs/promises');
  const fallback = OUT_MP4.replace('.mp4', '.webm');
  await copyFile(srcWebm, fallback);
  console.warn('ffmpeg not found — saved as .webm instead:', fallback);
  console.warn('Install ffmpeg and re-run, or update the <source> src to .webm.');
}

console.log('\nDone. Now commit public/demo.mp4 and public/demo-poster.jpg.');
