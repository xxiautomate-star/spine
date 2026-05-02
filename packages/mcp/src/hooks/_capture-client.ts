// Tiny capture client for the SDK hooks. Avoids pulling the rest of the
// MCP server's stack into a host that's only using the hook.

export type CaptureItem = {
  content: string;
  type?: 'fact' | 'decision' | 'bug' | 'feature' | 'context';
  tags?: string[];
  session_id?: string;
  kind?: 'turn' | 'digest';
};

export interface SpineCaptureInput {
  apiKey: string;
  baseUrl?: string;
  bulk: CaptureItem[];
}

const DEFAULT_BASE = 'https://spine.xxiautomate.com';

export async function spineCapture(input: SpineCaptureInput): Promise<void> {
  const url = `${input.baseUrl ?? DEFAULT_BASE}/api/capture`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({ bulk: input.bulk }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`spine capture ${res.status}: ${text.slice(0, 200)}`);
  }
}
