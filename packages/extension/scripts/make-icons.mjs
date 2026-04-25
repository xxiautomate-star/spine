// Generates minimal brand icons (night background, amber spark) at 16/48/128.
// Pure-Node PNG encoder so the extension has no runtime dep on Sharp/Canvas.
// Run once; commit the resulting icons/.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'icons');
await mkdir(OUT, { recursive: true });

const NIGHT = [0x0d, 0x0c, 0x0a, 0xff];
const AMBER = [0xe8, 0x9a, 0x3c, 0xff];
const CREAM = [0xe8, 0xe4, 0xdd, 0xff];

for (const size of [16, 48, 128]) {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = (size - 1) / 2;
      const cy = (size - 1) / 2;
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const ringInner = size * 0.36;
      const ringOuter = size * 0.46;
      const dotRadius = size * 0.14;

      let color = NIGHT;
      if (r < dotRadius) color = AMBER;
      else if (r >= ringInner && r <= ringOuter) color = CREAM;

      const idx = (y * size + x) * 4;
      px[idx] = color[0];
      px[idx + 1] = color[1];
      px[idx + 2] = color[2];
      px[idx + 3] = color[3];
    }
  }
  const png = encodePng(size, size, px);
  await writeFile(join(OUT, `icon-${size}.png`), png);
  console.log(`wrote icons/icon-${size}.png`);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
