// Options page controller. Loads settings from chrome.storage.sync, binds the
// inputs, persists on Save. The "your dashboard" link mirrors the configured
// endpoint so changing endpoint keeps the link valid.

import { getSettings, setSettings, DEFAULT_SETTINGS } from '../common/storage.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

async function load() {
  const s = await getSettings();
  q<HTMLInputElement>('apiKey').value = s.apiKey;
  q<HTMLInputElement>('endpoint').value = s.endpoint;
  q<HTMLInputElement>('captureChatGPT').checked = s.captureChatGPT;
  q<HTMLInputElement>('captureGemini').checked = s.captureGemini;
  q<HTMLInputElement>('autoInject').checked = s.autoInject;
  syncDashLink(s.endpoint);
}

function syncDashLink(endpoint: string) {
  const link = $('dashLink') as HTMLAnchorElement | null;
  if (!link) return;
  const base = endpoint.trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.endpoint;
  link.href = `${base}/dashboard/keys`;
}

async function save() {
  const apiKey = q<HTMLInputElement>('apiKey').value.trim();
  const endpoint = q<HTMLInputElement>('endpoint').value.trim() || DEFAULT_SETTINGS.endpoint;
  const captureChatGPT = q<HTMLInputElement>('captureChatGPT').checked;
  const captureGemini = q<HTMLInputElement>('captureGemini').checked;
  const autoInject = q<HTMLInputElement>('autoInject').checked;

  await setSettings({ apiKey, endpoint, captureChatGPT, captureGemini, autoInject });
  syncDashLink(endpoint);
  flash('Saved.');
}

function flash(msg: string) {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

function q<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

document.addEventListener('DOMContentLoaded', () => {
  void load();
  q<HTMLInputElement>('endpoint').addEventListener('input', (e) =>
    syncDashLink((e.target as HTMLInputElement).value)
  );
  q<HTMLButtonElement>('save').addEventListener('click', () => void save());
});
