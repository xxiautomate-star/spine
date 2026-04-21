/**
 * spine.config — per-project configuration discovery.
 *
 * Walks up from the current working directory looking for:
 *   spine.config.json
 *   spine.config.js  (ESM or CJS default export)
 *   spine.config.mjs
 *   .spine/config.json
 *
 * Returns null if no config is found.
 *
 * Example spine.config.json:
 * {
 *   "project": "my-app",
 *   "capture": {
 *     "autoCapture": true,
 *     "minLength": 80,
 *     "ignore": ["*.env", "node_modules/**"]
 *   },
 *   "memory": {
 *     "shareWith": ["related-project"],
 *     "retention": "2y"
 *   },
 *   "briefing": {
 *     "enabled": true,
 *     "slack": "https://hooks.slack.com/services/..."
 *   }
 * }
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface SpineProjectConfig {
  project?: string;
  capture?: {
    autoCapture?: boolean;
    minLength?: number;
    ignore?: string[];
  };
  memory?: {
    shareWith?: string[];
    retention?: string;
    visibility?: 'personal' | 'team' | 'org';
  };
  briefing?: {
    enabled?: boolean;
    slack?: string;
  };
}

const CANDIDATES = [
  'spine.config.json',
  'spine.config.js',
  'spine.config.mjs',
  '.spine/config.json',
];

async function tryLoadJson(filePath: string): Promise<SpineProjectConfig | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as SpineProjectConfig;
  } catch {
    return null;
  }
}

async function tryLoadJs(filePath: string): Promise<SpineProjectConfig | null> {
  try {
    const url = pathToFileURL(filePath).href;
    const mod = (await import(url)) as { default?: SpineProjectConfig } | SpineProjectConfig;
    const config = (mod as { default?: SpineProjectConfig }).default ?? (mod as SpineProjectConfig);
    if (config && typeof config === 'object') return config;
    return null;
  } catch {
    return null;
  }
}

export async function loadProjectConfig(startDir?: string): Promise<SpineProjectConfig | null> {
  let dir = startDir ?? process.cwd();
  const root = dirname(dir); // rough stop at FS root

  for (let depth = 0; depth < 8; depth++) {
    for (const candidate of CANDIDATES) {
      const filePath = join(dir, candidate);
      if (!existsSync(filePath)) continue;

      if (candidate.endsWith('.json')) {
        const cfg = await tryLoadJson(filePath);
        if (cfg) return cfg;
      } else {
        const cfg = await tryLoadJs(filePath);
        if (cfg) return cfg;
      }
    }

    const parent = dirname(dir);
    if (parent === dir || parent === root) break;
    dir = parent;
  }

  return null;
}

/** Merge project config into capture input — adds project tag, respects ignore list. */
export function applyConfigToCapture(
  content: string,
  config: SpineProjectConfig | null,
  extraTags: string[] = []
): { tags: string[]; project: string | null; skip: boolean } {
  const tags = [...extraTags];
  const project = config?.project ?? null;

  if (project && !tags.includes(project)) {
    tags.push(project);
  }

  const minLen = config?.capture?.minLength ?? 40;
  if (content.trim().length < minLen) {
    return { tags, project, skip: true };
  }

  return { tags, project, skip: false };
}
