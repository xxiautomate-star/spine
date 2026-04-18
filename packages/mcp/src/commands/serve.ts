import { DB_PATH, DEFAULT_API_BASE, readConfig } from '../config.js';
import { CloudStore } from '../store/cloud.js';
import { LocalStore } from '../store/local.js';
import { startServer } from '../server.js';
import type { Store } from '../store/index.js';

export async function serveCommand(): Promise<void> {
  const cfg = await readConfig();
  let store: Store;
  if (cfg.mode === 'cloud' && cfg.apiKey) {
    const base = cfg.apiBase ?? DEFAULT_API_BASE;
    store = new CloudStore(base, cfg.apiKey);
    console.error(`[spine] cloud mode via ${base}`);
  } else {
    store = new LocalStore(DB_PATH);
    console.error(`[spine] local mode via ${DB_PATH}`);
  }
  await startServer(store);
}
