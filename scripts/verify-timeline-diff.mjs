// Visual smoke-check: load /dashboard/timeline against the dev server,
// screenshot the slider for visual sanity. Does NOT auth — if the page
// redirects to /login we'll see that and adjust.
import { chromium } from 'playwright';

const BASE = process.env.SPINE_DEV_URL ?? 'http://localhost:3002';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on('pageerror', (e) => console.error('pageerror:', e.message));

await page.goto(`${BASE}/dashboard/timeline`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/spine-timeline.png', fullPage: false });
console.log('saved /tmp/spine-timeline.png at', page.url());
await browser.close();
