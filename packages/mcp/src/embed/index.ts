export interface Embedder {
  readonly dims: number;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    aa += ai * ai;
    bb += bi * bi;
  }
  const denom = Math.sqrt(aa) * Math.sqrt(bb);
  return denom === 0 ? 0 : dot / denom;
}
