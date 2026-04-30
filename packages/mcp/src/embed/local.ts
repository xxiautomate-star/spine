import type { Embedder } from './index.js';

// `@huggingface/transformers` (via `onnxruntime-node`) ships a prebuilt native
// binary that links against glibc. On musl-libc systems (Alpine) the dlopen
// fails at top-level import — meaning even `spine-mcp --version` would crash
// just because store/local.ts transitively imports this file.
//
// Fix: lazy-load. The transformers pipeline only matters once a user actually
// runs in local-store mode AND captures something. Cloud-store users (the
// device-flow happy path we just shipped) never hit it. Defer the require to
// the first embed() call so:
//   - boot is free of native-binary constraints
//   - alpine + cloud-mode works
//   - alpine + local-mode still fails, but with a clear error at the call
//     site rather than a cryptic dlopen during CLI startup

type FeatureOutput = { data: Float32Array; dims: number[] };
type Extractor = (
  input: string | string[],
  opts: { pooling: 'mean'; normalize: boolean }
) => Promise<FeatureOutput>;

let cached: Promise<Extractor> | null = null;

async function getPipe(): Promise<Extractor> {
  if (!cached) {
    cached = (async () => {
      const transformers = await import('@huggingface/transformers');
      transformers.env.allowLocalModels = true;
      const pipe = await transformers.pipeline(
        'feature-extraction',
        'Xenova/bge-small-en-v1.5'
      );
      return pipe as unknown as Extractor;
    })();
    // If the underlying load fails, drop the cache so the next call retries
    // with a fresh import — otherwise a transient failure would brick the
    // process for the rest of its lifetime.
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

export const localEmbedder: Embedder = {
  dims: 384, // BAAI/bge-small-en-v1.5

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
