import { DB_PATH, DEFAULT_API_BASE, readConfig } from '../config.js';
import { CloudStore } from '../store/cloud.js';
import { LocalStore } from '../store/local.js';
import { getLicense, type LicenseStatus } from '../license.js';
import { startServer } from '../server.js';
import type { Store } from '../store/index.js';

/**
 * The license is cached on disk with a 6h TTL by `getLicense`, so these
 * refreshes are cheap — most calls will hit the cache file and return
 * immediately. The background timer exists so that a cancellation made
 * midway through a long MCP session is picked up within an hour.
 */
const BACKGROUND_REFRESH_MS = 60 * 60 * 1000; // 1 hour

export async function serveCommand(): Promise<void> {
  const cfg = await readConfig();
  const apiBase = cfg.apiBase ?? DEFAULT_API_BASE;

  // Prime the license cache at boot so the first capture doesn't block
  // on a network call. Callers downstream read the cached value.
  let currentStatus: LicenseStatus = await getLicense({
    apiKey: cfg.apiKey,
    apiBase,
  });

  const getStatus = () => currentStatus;

  // Background refresh. Keeps the cache warm across long sessions and
  // catches subscription changes mid-run. Failures are swallowed — we
  // already hold a cache status and `getLicense` honours the grace window.
  const timer = setInterval(() => {
    void getLicense({ apiKey: cfg.apiKey, apiBase })
      .then((s) => {
        currentStatus = s;
      })
      .catch(() => {
        /* best-effort */
      });
  }, BACKGROUND_REFRESH_MS);
  // Don't keep the event loop alive just for the refresher.
  if (typeof timer.unref === 'function') timer.unref();

  let store: Store;
  if (cfg.mode === 'cloud' && cfg.apiKey && currentStatus.plan !== 'free') {
    store = new CloudStore(apiBase, cfg.apiKey);
    console.error(
      `[spine] cloud mode via ${apiBase} · plan=${currentStatus.plan} · reason=${currentStatus.reason}`,
    );
  } else {
    // Cloud mode with a lapsed subscription falls back to local — the user
    // keeps access to their memories but can't sync new ones.
    const downgraded =
      cfg.mode === 'cloud' && cfg.apiKey && currentStatus.plan === 'free';
    store = new LocalStore(DB_PATH, { getLicenseStatus: getStatus });
    const base = downgraded ? 'cloud-downgraded → local' : 'local mode';
    console.error(
      `[spine] ${base} via ${DB_PATH} · plan=${currentStatus.plan} · reason=${currentStatus.reason}`,
    );
    if (currentStatus.cap !== null) {
      console.error(
        `[spine] free-tier cap = ${currentStatus.cap} memories · upgrade at ${currentStatus.upgradeUrl}`,
      );
    }
  }
  await startServer(store);
}
