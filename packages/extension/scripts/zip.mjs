// Produces packages/extension/spine-extension-<version>.zip from dist/.
// Used for Chrome Web Store submission. Pure-Node tar-style zip (no deps).

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeflateRaw } from 'node:zlib';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');

if (!existsSync(DIST)) {
  console.error('[spine-extension] dist/ missing — run `npm run build` first.');
  process.exit(1);
}

const manifestRaw = await readFile(join(DIST, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestRaw);
const out = join(ROOT, `spine-extension-${manifest.version}.zip`);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function deflate(buf) {
  return new Promise((resolve, reject) => {
    const z = createDeflateRaw({ level: 9 });
    const chunks = [];
    z.on('data', (c) => chunks.push(c));
    z.on('end', () => resolve(Buffer.concat(chunks)));
    z.on('error', reject);
    z.end(buf);
  });
}

const records = [];
const central = [];
let offset = 0;

for await (const file of walk(DIST)) {
  const name = relative(DIST, file).replace(/\\/g, '/');
  const data = await readFile(file);
  const compressed = await deflate(data);
  const crc = crc32(data);
  const nameBuf = Buffer.from(name, 'utf8');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  records.push(local, nameBuf, compressed);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0, 8);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt16LE(0, 12);
  cd.writeUInt16LE(0, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(compressed.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt16LE(0, 30);
  cd.writeUInt16LE(0, 32);
  cd.writeUInt16LE(0, 34);
  cd.writeUInt16LE(0, 36);
  cd.writeUInt32LE(0, 38);
  cd.writeUInt32LE(offset, 42);
  central.push(cd, nameBuf);

  offset += local.length + nameBuf.length + compressed.length;
}

const cdSize = central.reduce((a, b) => a + b.length, 0);
const cdOffset = offset;
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(records.length / 3, 8);
end.writeUInt16LE(records.length / 3, 10);
end.writeUInt32LE(cdSize, 12);
end.writeUInt32LE(cdOffset, 16);
end.writeUInt16LE(0, 20);

await writeFile(out, Buffer.concat([...records, ...central, end]));
const finalSize = (await stat(out)).size;
console.log(`[spine-extension] packaged ${out} (${finalSize} bytes)`);
