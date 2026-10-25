// Draws the app icons for the mobile port (public/icon-192.png, icon-512.png): a blue NOC square and an
// orange AI diamond joined by fiber, on the game's dark background. Plain PNG encoding, no dependencies.
// Also writes the Android launcher icons when the Capacitor project (android/) exists.
// Usage: node scripts/make-icons.ts
import { existsSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/** `art`: share of the icon the drawing spans (Android adaptive icons crop to the middle ~66%). */
function png(size: number, art = 1): Buffer {
  const px = Buffer.alloc(size * size * 4);
  const set = (x: number, y: number, [r, g, b]: number[]) => { const i = (y * size + x) * 4; px[i] = r!; px[i + 1] = g!; px[i + 2] = b!; px[i + 3] = 255; };
  const s = (size * art) / 512;
  const off = (size - size * art) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [u, v] = [(x - off) / s, (y - off) / s];
      let c = [11, 14, 18];
      if (Math.abs(v - 256) < 10 && u > 150 && u < 360) c = [74, 163, 255]; // fiber
      if (Math.abs(u - 150) < 70 && Math.abs(v - 256) < 70) c = [74, 163, 255]; // NOC
      if (Math.abs(u - 150) < 50 && Math.abs(v - 256) < 50) c = [29, 59, 92];
      if (Math.abs(u - 370) + Math.abs(v - 256) < 90) c = [255, 138, 61]; // AI core
      if (Math.abs(u - 370) + Math.abs(v - 256) < 55) c = [92, 45, 18];
      set(x, y, c);
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [192, 512]) writeFileSync(`public/icon-${size}.png`, png(size));
console.log('wrote public/icon-192.png, public/icon-512.png');

if (existsSync('android/app/src/main/res')) {
  const densities: Record<string, number> = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, size] of Object.entries(densities)) {
    const dir = `android/app/src/main/res/mipmap-${d}`;
    writeFileSync(`${dir}/ic_launcher.png`, png(size, 0.9));
    writeFileSync(`${dir}/ic_launcher_round.png`, png(size, 0.8));
    writeFileSync(`${dir}/ic_launcher_foreground.png`, png(Math.round(size * 2.25), 0.6));
  }
  writeFileSync('android/app/src/main/res/values/ic_launcher_background.xml',
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B0E12</color>\n</resources>\n');
  console.log('wrote Android launcher icons');
}
