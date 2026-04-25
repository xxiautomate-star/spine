// FNV-1a 64-bit hash. Stable, dep-free, fast. Used to dedupe captured turns
// so we never send the same content twice across DOM mutations.

export function fnv1a64(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9dc5_811c;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c & 0xff;
    h2 ^= (c >> 8) & 0xff;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
