import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type Config = {
  mode: 'local' | 'cloud';
  apiKey?: string;
  apiBase?: string;
};

export const CONFIG_DIR = join(homedir(), '.spine');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const DB_PATH = join(CONFIG_DIR, 'memories.db');
export const DEFAULT_API_BASE = 'https://spine.xxiautomate.com/api';

export async function readConfig(): Promise<Config> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.mode === 'local' || parsed.mode === 'cloud')) {
      return parsed as Config;
    }
    return { mode: 'local' };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { mode: 'local' };
    }
    throw err;
  }
}

export async function writeConfig(cfg: Config): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}
