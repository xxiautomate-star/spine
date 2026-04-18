const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_ENDPOINT = 'https://api.openai.com/v1/embeddings';

export const EMBED_DIMS = 1536;

async function callOpenAI(input: string | string[]): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not configured on the server.');
  const res = await fetch(EMBED_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data.map((d) => d.embedding);
}

export async function embedText(text: string): Promise<number[]> {
  const [v] = await callOpenAI(text);
  return v;
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  return callOpenAI(texts);
}
