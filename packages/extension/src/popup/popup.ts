// Toolbar popup. Shows queue depth + last sync, lets the user force a flush
// or jump to settings. Stays out of the way; this is a status panel, not the
// configuration surface.

import { readQueue, getSettings } from '../common/storage.js';
import type { FlushRequest, FlushResponse } from '../common/messages.js';

async function refresh() {
  const status = document.getElementById('status');
  if (!status) return;
  const [queue, settings] = await Promise.all([readQueue(), getSettings()]);
  if (!settings.apiKey) {
    status.textContent = 'No API key yet. Open settings to paste one from your dashboard.';
    return;
  }
  if (queue.length === 0) {
    status.textContent = 'Up to date. Spine is listening on the sites you enabled.';
    return;
  }
  status.textContent = `${queue.length} ${queue.length === 1 ? 'memory' : 'memories'} queued for sync.`;
}

document.addEventListener('DOMContentLoaded', () => {
  void refresh();

  const flush = document.getElementById('flush') as HTMLButtonElement | null;
  flush?.addEventListener('click', async () => {
    flush.disabled = true;
    const original = flush.textContent;
    flush.textContent = 'Flushing…';
    try {
      const msg: FlushRequest = { type: 'spine.flush' };
      const res = (await chrome.runtime.sendMessage(msg)) as FlushResponse | undefined;
      const status = document.getElementById('status');
      if (status) {
        if (res?.ok) status.textContent = `Sent ${res.flushed}.`;
        else status.textContent = res?.error ?? 'Flush failed.';
      }
    } finally {
      flush.disabled = false;
      flush.textContent = original ?? 'Flush queue';
      void refresh();
    }
  });

  const open = document.getElementById('open') as HTMLButtonElement | null;
  open?.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
});
