#!/usr/bin/env node
// Chrome Web Store screenshot capture — 1280×800 per store spec.
// Produces 5 images in screenshots/store/:
//   01-popup-uptodate.png   — popup "up to date" on ChatGPT background
//   02-popup-hygiene.png    — popup hygiene amber stat row
//   03-options-page.png     — options page (real extension)
//   04-dashboard-timeline.png — memory timeline mock
//   05-mcp-recall.png       — MCP terminal + Claude recall split scene
//
// Requirements:
//   npm install -D playwright          (root devDep)
//   npm run extension:build            (must run first)
//   npx playwright install chromium    (first time only)
//
// Usage:
//   node scripts/capture-store-screenshots.mjs
//   APP_URL=https://spine.xxiautomate.com node scripts/capture-store-screenshots.mjs

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const EXT_DIR   = join(ROOT, 'packages', 'extension', 'dist');
const OUT_DIR   = join(ROOT, 'screenshots', 'store');
const VIEWPORT  = { width: 1280, height: 800 };
const APP_URL   = process.env.APP_URL ?? 'http://localhost:3000';

if (!existsSync(EXT_DIR)) {
  console.error(`Extension not built. Run: npm run extension:build`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

// ── Google Fonts link (loads when online) ─────────────────────────────────
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`;

const CSS_VARS = `
  :root {
    --night:  #0d0c0a;
    --night2: #15130f;
    --cream:  #e8e4dd;
    --cream2: rgba(232,228,221,0.62);
    --cream3: rgba(232,228,221,0.18);
    --amber:  #e89a3c;
    --ink:    #4a5e7a;
    --serif:  'Instrument Serif', Georgia, serif;
    --sans:   'Inter', system-ui, sans-serif;
    --mono:   'JetBrains Mono', ui-monospace, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--night); color: var(--cream); font-family: var(--sans); -webkit-font-smoothing: antialiased; }
`;

// ── ChatGPT-mock background ────────────────────────────────────────────────
function chatgptBg() {
  return `
    <style>
      .cgpt-root { display:flex; width:1280px; height:800px; background:#212121; font-family:'Inter',system-ui,sans-serif; color:#ececec; }
      .cgpt-sidebar { width:260px; flex-shrink:0; background:#171717; display:flex; flex-direction:column; padding:12px 8px; gap:2px; }
      .cgpt-sidebar-btn { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; font-size:14px; color:#ececec; cursor:pointer; }
      .cgpt-sidebar-btn:hover { background:rgba(255,255,255,0.06); }
      .cgpt-sidebar-btn svg { opacity:0.7; flex-shrink:0; }
      .cgpt-sidebar-section { font-size:11px; color:rgba(236,236,236,0.4); letter-spacing:0.06em; text-transform:uppercase; padding:16px 12px 6px; }
      .cgpt-conv { padding:8px 12px; border-radius:8px; font-size:13px; color:rgba(236,236,236,0.7); cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cgpt-conv:hover { background:rgba(255,255,255,0.06); }
      .cgpt-conv.active { background:rgba(255,255,255,0.1); color:#ececec; }
      .cgpt-main { flex:1; display:flex; flex-direction:column; }
      .cgpt-topbar { height:50px; display:flex; align-items:center; padding:0 20px; border-bottom:1px solid rgba(255,255,255,0.06); font-size:14px; font-weight:500; color:rgba(236,236,236,0.8); gap:8px; }
      .cgpt-model-badge { font-size:12px; background:rgba(255,255,255,0.08); border-radius:6px; padding:3px 8px; }
      .cgpt-messages { flex:1; padding:32px 48px; display:flex; flex-direction:column; gap:28px; overflow:hidden; }
      .cgpt-msg { display:flex; gap:16px; align-items:flex-start; }
      .cgpt-msg.user { flex-direction:row-reverse; }
      .cgpt-avatar { width:32px; height:32px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:600; }
      .cgpt-avatar.ai { background:linear-gradient(135deg,#10a37f,#0d7a60); color:#fff; }
      .cgpt-avatar.user { background:rgba(255,255,255,0.15); color:#ececec; }
      .cgpt-bubble { max-width:520px; font-size:14px; line-height:1.65; color:rgba(236,236,236,0.9); }
      .cgpt-bubble.user { background:rgba(255,255,255,0.08); border-radius:16px 16px 4px 16px; padding:12px 16px; }
      .cgpt-input-area { padding:16px 48px 24px; border-top:1px solid rgba(255,255,255,0.06); }
      .cgpt-input { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:14px 18px; font-size:14px; color:rgba(236,236,236,0.5); }
      /* toolbar dots */
      .cgpt-toolbar-ext { position:absolute; top:12px; right:20px; display:flex; gap:4px; align-items:center; }
      .cgpt-toolbar-ext .ext-btn { width:28px; height:28px; border-radius:50%; background:rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center; }
      .cgpt-toolbar-ext .ext-btn.spine { background:#e89a3c; position:relative; }
      .cgpt-toolbar-ext .ext-btn.spine::after { content:''; position:absolute; bottom:-6px; left:50%; transform:translateX(-50%); width:0; height:0; border-left:6px solid transparent; border-right:6px solid transparent; border-top:6px solid #e89a3c; }
    </style>
    <div class="cgpt-root" style="position:relative;">
      <div class="cgpt-sidebar">
        <div class="cgpt-sidebar-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          New chat
        </div>
        <div style="height:12px;"></div>
        <div class="cgpt-sidebar-section">Today</div>
        <div class="cgpt-conv active">Building memory systems for AI</div>
        <div class="cgpt-conv">React performance patterns</div>
        <div class="cgpt-conv">Postgres vector search setup</div>
        <div class="cgpt-sidebar-section">Yesterday</div>
        <div class="cgpt-conv">Marketing copy for launch</div>
        <div class="cgpt-conv">Next.js App Router migration</div>
        <div class="cgpt-conv">Stripe webhook debugging</div>
        <div class="cgpt-sidebar-section">Last 7 days</div>
        <div class="cgpt-conv">TypeScript strict mode</div>
        <div class="cgpt-conv">Deployment pipeline setup</div>
        <div class="cgpt-conv">API rate limiting strategy</div>
      </div>
      <div class="cgpt-main">
        <div class="cgpt-topbar" style="position:relative;">
          <span>ChatGPT</span><span class="cgpt-model-badge">GPT-4o</span>
          <div class="cgpt-toolbar-ext">
            <div class="ext-btn"></div>
            <div class="ext-btn"></div>
            <div class="ext-btn spine"></div>
          </div>
        </div>
        <div class="cgpt-messages">
          <div class="cgpt-msg">
            <div class="cgpt-avatar ai">G</div>
            <div class="cgpt-bubble">
              I remember you prefer pgvector over Pinecone for cost reasons, and that you're building on Next.js 15 with the App Router. Happy to dive into whatever you need today.
            </div>
          </div>
          <div class="cgpt-msg user">
            <div class="cgpt-avatar user">R</div>
            <div class="cgpt-bubble user">Can you help me optimise the recall latency on the memory pipeline?</div>
          </div>
          <div class="cgpt-msg">
            <div class="cgpt-avatar ai">G</div>
            <div class="cgpt-bubble">
              Sure. Given your Supabase setup with HNSW indexing on the embedding column, the bottleneck is usually the reranking pass. A few options…
            </div>
          </div>
        </div>
        <div class="cgpt-input-area">
          <div class="cgpt-input">Message ChatGPT</div>
        </div>
      </div>
    </div>
  `;
}

// ── Popup component HTML ───────────────────────────────────────────────────
function popupHtml({ status, showHygiene, dups, stale }) {
  const hygieneMsg = showHygiene ? '' : 'No data yet.';
  return `
    <div style="
      position:absolute; top:56px; right:20px;
      width:280px;
      background:var(--night);
      border-radius:0 0 12px 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.5);
      overflow:hidden;
    ">
      <div style="padding:22px 22px 20px;">
        <p style="font-family:var(--mono);font-size:10px;letter-spacing:0.22em;color:var(--cream2);margin:0 0 10px;text-transform:uppercase;">SPINE</p>
        <h1 style="font-family:var(--serif);font-weight:400;font-size:24px;margin:0 0 12px;letter-spacing:-0.005em;">Memory, ongoing.</h1>
        <p style="font-size:13px;color:var(--cream2);margin:0 0 16px;line-height:1.5;">${status}</p>

        <div style="border-top:1px solid rgba(232,228,221,0.1);padding:12px 0 4px;margin-bottom:12px;">
          <p style="font-family:var(--mono);font-size:9px;letter-spacing:0.18em;color:var(--cream2);text-transform:uppercase;margin:0 0 7px;">Archive</p>
          ${showHygiene ? `
            <div>
              <div style="display:flex;align-items:baseline;gap:5px;font-size:12px;color:var(--cream2);margin-bottom:8px;flex-wrap:wrap;">
                <span><strong style="color:var(--amber);font-size:15px;font-weight:600;font-family:var(--mono);margin-right:2px;">${dups}</strong> duplicates</span>
                <span style="color:rgba(232,228,221,0.3);">·</span>
                <span><strong style="color:var(--amber);font-size:15px;font-weight:600;font-family:var(--mono);margin-right:2px;">${stale}</strong> stale</span>
              </div>
              <a style="display:inline-block;font-size:11px;font-weight:600;color:var(--amber);text-decoration:none;cursor:pointer;letter-spacing:0.01em;">Tend your archive →</a>
            </div>
          ` : `<p style="font-size:12px;color:var(--cream2);margin:0;">${hygieneMsg}</p>`}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button style="font-family:var(--sans);font-size:12px;font-weight:600;letter-spacing:0.005em;border-radius:8px;padding:10px 12px;cursor:pointer;background:var(--amber);color:var(--night);border:none;">Flush queue</button>
          <button style="font-family:var(--sans);font-size:12px;font-weight:600;letter-spacing:0.005em;border-radius:8px;padding:10px 12px;cursor:pointer;background:transparent;color:var(--cream);border:1px solid rgba(232,228,221,0.2);">Open settings</button>
        </div>
      </div>
    </div>
  `;
}

// ── Scene: popup "up to date" ──────────────────────────────────────────────
function scenePopupUpToDate() {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${CSS_VARS}</style></head><body>
    <div style="position:relative;width:1280px;height:800px;overflow:hidden;">
      ${chatgptBg()}
      ${popupHtml({ status: 'Up to date. Spine is listening on the sites you enabled.', showHygiene: false, dups: 0, stale: 0 })}
    </div>
  </body></html>`;
}

// ── Scene: popup hygiene ───────────────────────────────────────────────────
function scenePopupHygiene() {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${CSS_VARS}</style></head><body>
    <div style="position:relative;width:1280px;height:800px;overflow:hidden;">
      ${chatgptBg()}
      ${popupHtml({ status: '3 memories queued for sync.', showHygiene: true, dups: 4, stale: 7 })}
    </div>
  </body></html>`;
}

// ── Scene: dashboard memory timeline (mock) ───────────────────────────────
function sceneDashboard() {
  const memories = [
    { time: '2 min ago', source: 'claude.ai', content: 'Prefer pgvector over Pinecone — cost matters more than managed infrastructure at this stage.', tags: ['engineering', 'infra'] },
    { time: '1 hr ago',  source: 'chatgpt.com', content: 'Working on Spine: memory layer for AI. Next.js 15 + Supabase + pgvector. Deploy on Vultr Sydney via Coolify.', tags: ['project', 'spine'] },
    { time: '3 hr ago',  source: 'gemini.google.com', content: 'Prefers direct, technical communication. No hand-holding. Assume strong engineering background.', tags: ['preference'] },
  ];

  const memoryCards = memories.map(m => `
    <div style="
      background:var(--night2);
      border:1px solid var(--cream3);
      border-radius:12px;
      padding:18px 20px;
      display:flex;
      flex-direction:column;
      gap:10px;
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:6px;height:6px;border-radius:50%;background:var(--amber);flex-shrink:0;"></div>
          <span style="font-family:var(--mono);font-size:11px;color:var(--cream2);">${m.source}</span>
        </div>
        <span style="font-family:var(--mono);font-size:11px;color:rgba(232,228,221,0.3);">${m.time}</span>
      </div>
      <p style="font-size:14px;line-height:1.6;color:var(--cream);margin:0;">${m.content}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${m.tags.map(t => `<span style="font-family:var(--mono);font-size:10px;letter-spacing:0.08em;background:rgba(232,228,221,0.06);border:1px solid var(--cream3);border-radius:4px;padding:2px 8px;color:var(--cream2);">${t}</span>`).join('')}
      </div>
    </div>
  `).join('');

  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}
  <style>
    ${CSS_VARS}
    body { width:1280px; height:800px; overflow:hidden;
      background: radial-gradient(circle at 18% 0%,rgba(232,154,60,0.07),transparent 55%),
                  radial-gradient(circle at 92% 100%,rgba(74,94,122,0.06),transparent 60%),
                  var(--night); }
  </style></head><body>
    <div style="display:flex;height:800px;">
      <!-- sidebar -->
      <nav style="width:220px;flex-shrink:0;border-right:1px solid var(--cream3);padding:28px 16px;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;align-items:center;gap:10px;padding:0 8px 28px;">
          <div style="width:28px;height:28px;background:var(--amber);border-radius:6px;"></div>
          <span style="font-family:var(--serif);font-size:18px;">Spine</span>
        </div>
        ${['Memories','Recall','Hygiene','API Keys','Billing'].map((label, i) => `
          <a style="
            display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;
            font-size:13px;font-weight:500;text-decoration:none;
            ${i === 0 ? 'background:rgba(232,228,221,0.06);color:var(--cream);' : 'color:var(--cream2);'}
          ">${label}</a>
        `).join('')}
        <div style="flex:1;"></div>
        <div style="padding:12px;border-radius:8px;background:rgba(232,154,60,0.1);border:1px solid rgba(232,154,60,0.2);">
          <p style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;color:var(--amber);text-transform:uppercase;margin-bottom:4px;">Free plan</p>
          <p style="font-size:12px;color:var(--cream2);">3 / 100 memories</p>
          <div style="height:3px;background:var(--cream3);border-radius:2px;margin-top:8px;">
            <div style="width:3%;height:3px;background:var(--amber);border-radius:2px;"></div>
          </div>
        </div>
      </nav>
      <!-- main -->
      <div style="flex:1;padding:40px 48px;overflow:hidden;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:32px;">
          <div>
            <h1 style="font-family:var(--serif);font-weight:400;font-size:32px;letter-spacing:-0.02em;margin-bottom:6px;">Your archive.</h1>
            <p style="font-size:14px;color:var(--cream2);">3 memories · last captured 2 minutes ago</p>
          </div>
          <div style="display:flex;gap:8px;">
            <input placeholder="Search memories…" style="
              background:var(--night2);border:1px solid var(--cream3);border-radius:8px;
              padding:8px 14px;font-size:13px;color:var(--cream2);outline:none;width:220px;
              font-family:var(--sans);
            "/>
          </div>
        </div>
        <div style="display:flex;gap:14px;margin-bottom:24px;">
          ${['All sources','claude.ai','chatgpt.com','gemini.google.com'].map((f, i) => `
            <button style="
              font-size:12px;font-weight:500;font-family:var(--sans);
              padding:5px 12px;border-radius:20px;cursor:pointer;
              ${i === 0 ? 'background:var(--cream);color:var(--night);border:none;' : 'background:transparent;color:var(--cream2);border:1px solid var(--cream3);'}
            ">${f}</button>
          `).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${memoryCards}
        </div>
      </div>
    </div>
  </body></html>`;
}

// ── Scene: MCP terminal + Claude recall ──────────────────────────────────
function sceneMcpRecall() {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}
  <style>
    ${CSS_VARS}
    body { width:1280px; height:800px; overflow:hidden;
      background: radial-gradient(circle at 10% 50%,rgba(232,154,60,0.05),transparent 50%),
                  var(--night); }
    .terminal { background:#1a1a1a; border-radius:12px; border:1px solid rgba(255,255,255,0.1); overflow:hidden; }
    .term-bar { background:#2a2a2a; padding:12px 16px; display:flex; align-items:center; gap:8px; }
    .dot { width:12px; height:12px; border-radius:50%; }
    .term-title { font-family:var(--mono); font-size:11px; color:rgba(255,255,255,0.4); margin-left:auto; margin-right:auto; }
    .term-body { padding:20px 22px; font-family:var(--mono); font-size:13px; line-height:1.7; }
    .prompt { color:#e89a3c; }
    .cmd { color:#e8e4dd; }
    .out { color:rgba(232,228,221,0.5); }
    .success { color:#10b981; }
    .claude-bubble { background:rgba(232,228,221,0.04); border:1px solid rgba(232,228,221,0.1); border-radius:12px; padding:18px 20px; font-size:14px; line-height:1.65; color:var(--cream); }
    .recall-tag { display:inline-block; font-family:var(--mono); font-size:10px; letter-spacing:0.08em; background:rgba(232,154,60,0.15); border:1px solid rgba(232,154,60,0.3); color:var(--amber); border-radius:4px; padding:2px 8px; margin-bottom:10px; }
  </style></head><body>
    <div style="display:flex;height:800px;gap:0;">
      <!-- LEFT: terminal -->
      <div style="width:580px;flex-shrink:0;padding:48px 40px;display:flex;flex-direction:column;gap:20px;border-right:1px solid var(--cream3);">
        <div>
          <p style="font-family:var(--mono);font-size:10px;letter-spacing:0.22em;color:var(--cream2);text-transform:uppercase;margin-bottom:8px;">Install in 30 seconds</p>
          <h2 style="font-family:var(--serif);font-weight:400;font-size:26px;letter-spacing:-0.02em;line-height:1.2;color:var(--cream);">Your AI remembers every word.<br>Not a summary. Every word.</h2>
        </div>
        <div class="terminal">
          <div class="term-bar">
            <div class="dot" style="background:#ff5f57;"></div>
            <div class="dot" style="background:#febc2e;"></div>
            <div class="dot" style="background:#28c840;"></div>
            <span class="term-title">Terminal</span>
          </div>
          <div class="term-body">
            <div><span class="prompt">~ $ </span><span class="cmd">npx @spine/mcp</span></div>
            <div class="out" style="margin-top:4px;">Installing Spine MCP server…</div>
            <div class="out">Configuring Claude Desktop integration…</div>
            <div class="success">✓ Spine connected · 3 memories loaded</div>
            <div style="margin-top:12px;"><span class="prompt">~ $ </span><span class="cmd" style="opacity:0.4;">█</span></div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          ${[['Claude Code','claude_code'],['Claude Desktop','claude_desktop'],['ChatGPT','chrome_ext'],['Gemini','chrome_ext']].map(([label, badge]) => `
            <div style="background:var(--night2);border:1px solid var(--cream3);border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:10px;">
              <div style="width:8px;height:8px;border-radius:50%;background:#10b981;flex-shrink:0;"></div>
              <span style="font-size:13px;font-weight:500;">${label}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <!-- RIGHT: Claude conversation -->
      <div style="flex:1;padding:48px 44px;display:flex;flex-direction:column;gap:20px;overflow:hidden;">
        <div>
          <p style="font-family:var(--mono);font-size:10px;letter-spacing:0.22em;color:var(--cream2);text-transform:uppercase;margin-bottom:8px;">Context injected automatically</p>
          <h2 style="font-family:var(--serif);font-weight:400;font-size:26px;letter-spacing:-0.02em;line-height:1.2;">Claude picks up exactly<br>where you left off.</h2>
        </div>
        <!-- Claude chat mock -->
        <div style="flex:1;display:flex;flex-direction:column;gap:16px;overflow:hidden;">
          <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:14px 18px;font-size:14px;color:var(--cream2);align-self:flex-end;max-width:80%;">
            Help me pick between Pinecone and pgvector for my side project.
          </div>
          <div class="claude-bubble">
            <span class="recall-tag">↑ Spine recalled 2 memories</span><br>
            Given that you're already running Supabase for auth and prefer to keep costs low at this stage, <strong>pgvector is the clear choice</strong>. You mentioned this trade-off yourself last Thursday — managed infrastructure matters less than spend right now.<br><br>
            With your Next.js 15 setup, you can add HNSW indexing and be production-ready in about 30 minutes. Want me to write the migration?
          </div>
          <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:14px 18px;font-size:14px;color:var(--cream2);align-self:flex-end;max-width:80%;">
            Yes. And pull in my schema preferences too.
          </div>
          <div class="claude-bubble" style="opacity:0.7;">
            <span class="recall-tag">↑ Spine recalled 1 memory</span><br>
            On it. Using your standard naming conventions…
          </div>
        </div>
      </div>
    </div>
  </body></html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────
const userDataDir = join(tmpdir(), 'spine-screenshot-profile');

console.log('Launching Chrome with extension…');
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: VIEWPORT,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

// Resolve extension ID from service worker
let extId = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'))
  ? new URL(context.serviceWorkers()[0].url()).hostname
  : null;

if (!extId) {
  extId = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    context.on('serviceworker', (w) => {
      clearTimeout(timer);
      resolve(new URL(w.url()).hostname);
    });
  });
}

if (!extId) {
  console.warn('Could not resolve extension ID — options screenshot will be skipped.');
}

async function capture(page, outName) {
  await page.waitForTimeout(800); // let fonts paint
  await page.screenshot({ path: join(OUT_DIR, outName), fullPage: false });
  console.log(`  saved → screenshots/store/${outName}`);
}

// ── Screenshot 1: popup "up to date" ──────────────────────────────────────
console.log('\n[1/5] popup — up to date');
{
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.setContent(scenePopupUpToDate(), { waitUntil: 'networkidle' });
  await capture(page, '01-popup-uptodate.png');
  await page.close();
}

// ── Screenshot 2: popup hygiene ────────────────────────────────────────────
console.log('[2/5] popup — hygiene stats');
{
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.setContent(scenePopupHygiene(), { waitUntil: 'networkidle' });
  await capture(page, '02-popup-hygiene.png');
  await page.close();
}

// ── Screenshot 3: options page (real extension) ────────────────────────────
console.log('[3/5] options page');
if (extId) {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.goto(`chrome-extension://${extId}/options.html`, { waitUntil: 'load' });

  // Seed demo settings, then reload so the page renders with the values.
  await page.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.sync.set({
        spine_settings_v1: {
          apiKey: 'spine_live_pKvQmNxT8wYj3rLzA2hBdFeUcGsOp',
          endpoint: 'https://spine.xxiautomate.com',
          captureChatGPT: true,
          captureGemini: true,
          autoInject: true,
          hygienePoll: true,
        },
      }, resolve);
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await capture(page, '03-options-page.png');
  await page.close();
} else {
  console.warn('  [skip] no extension ID');
}

// ── Screenshot 4: dashboard timeline (mock) ────────────────────────────────
console.log('[4/5] dashboard — memory timeline');
{
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.setContent(sceneDashboard(), { waitUntil: 'networkidle' });
  await capture(page, '04-dashboard-timeline.png');
  await page.close();
}

// ── Screenshot 5: MCP install + Claude recall ─────────────────────────────
console.log('[5/5] MCP recall scene');
{
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.setContent(sceneMcpRecall(), { waitUntil: 'networkidle' });
  await capture(page, '05-mcp-recall.png');
  await page.close();
}

await context.close();
console.log(`\nDone. 5 screenshots in screenshots/store/\n`);
