// Visual smoke check for /proof. Screenshots both desktop + mobile.
import { chromium } from 'playwright';

const BASE = process.env.SPINE_DEV_URL ?? 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });

const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const dp = await desk.newPage();
await dp.goto(`${BASE}/proof`, { waitUntil: 'networkidle' });
await dp.waitForTimeout(800);
await dp.screenshot({ path: '/tmp/spine-proof-desktop.png', fullPage: false });
await dp.screenshot({ path: '/tmp/spine-proof-full.png', fullPage: true });
console.log('desktop saved');

const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await mob.newPage();
await mp.goto(`${BASE}/proof`, { waitUntil: 'networkidle' });
await mp.waitForTimeout(800);
await mp.screenshot({ path: '/tmp/spine-proof-mobile.png', fullPage: false });
console.log('mobile saved');

await browser.close();
