import { pipeline, env } from '@huggingface/transformers';
import type { Embedder } from './index.js';

env.allowLocalModels = true;

type FeatureOutput = { data: Float32Array; dims: number[] };
type Extractor = (
  input: string | string[],
  opts: { pooling: 'mean'; normalize: boolean }
) => Promise<FeatureOutput>;

let cached: Promise<Extractor> | null = null;

function getPipe(): Promise<Extractor> {
  if (!cached) {
    cached = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as unknown as Promise<Extractor>;
  }
  return cached;
}

export const localEmbedder: Embedder = {
  dims: 384,

  async embed(text) {
    const extract = await getPipe();
    const out = await extract(text, { pooling: 'mean', normalize: true });
    return new Float32Array(out.data);
  },

  async embedBatch(texts) {
    if (texts.length === 0) return [];
    const extract = await getPipe();
    const out = await extract(texts, { pooling: 'mean', normalize: true });
    const dim = out.dims[out.dims.length - 1];
    const flat = out.data;
    const result: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      result.push(new Float32Array(flat.buffer, flat.byteOffset + i * dim * 4, dim).slice());
    }
    return result;
  },
};
