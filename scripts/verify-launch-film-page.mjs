// Quick visual sanity check: load /, screenshot the hero so we can confirm
// the launch film embeds where InstallDemoLoop used to be.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
// Give the IntersectionObserver / video element a beat to start playing.
await page.waitForTimeout(1500);

await page.screenshot({ path: '/tmp/spine-hero.png', fullPage: false });
console.log('saved /tmp/spine-hero.png');

// Mobile pass — verify the 9x16 fallback shows up and the desktop demo is hidden.
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const m = await mobile.newPage();
await m.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await m.waitForTimeout(1500);
// Scroll past the hero copy on mobile so the screenshot includes the film
// section that lives below it (the lg:hidden block).
await m.evaluate(() => window.scrollTo(0, 700));
await m.waitForTimeout(500);
await m.screenshot({ path: '/tmp/spine-hero-mobile.png', fullPage: false });
console.log('saved /tmp/spine-hero-mobile.png');

await browser.close();
