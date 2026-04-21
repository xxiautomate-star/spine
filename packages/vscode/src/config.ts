import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

export interface SpineConfig {
  mode: 'local' | 'cloud';
  apiKey?: string;
  apiBase?: string;
}

export const DEFAULT_API_BASE = 'https://spine.xxiautomate.com/api';
const CONFIG_FILE = path.join(os.homedir(), '.spine', 'config.json');

export function readFileConfig(): SpineConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as SpineConfig;
  } catch {
    return null;
  }
}

export function getApiKey(): string | null {
  const vsConfig = vscode.workspace.getConfiguration('spine');
  const override = vsConfig.get<string>('apiKey');
  if (override && override.trim()) return override.trim();
  return readFileConfig()?.apiKey ?? null;
}

export function getApiBase(): string {
  const vsConfig = vscode.workspace.getConfiguration('spine');
  const override = vsConfig.get<string>('apiBase');
  if (override && override.trim()) return override.trim();
  return readFileConfig()?.apiBase ?? DEFAULT_API_BASE;
}

export function isConfigured(): boolean {
  return !!getApiKey();
}
