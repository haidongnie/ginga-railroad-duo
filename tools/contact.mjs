// Builds a labeled contact sheet of Meshy thumbnails: node tools/contact.mjs out.png
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve('assets-raw');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const S = 256, cols = 6, rows = Math.ceil(files.length / cols);
const comps = await Promise.all(files.map(async (f, i) => {
  const img = await sharp(path.join(dir, f)).resize(S, S, { fit: 'contain', background: '#333' }).toBuffer();
  const label = Buffer.from(`<svg width="${S}" height="24"><rect width="100%" height="100%" fill="#000a"/><text x="6" y="17" font-size="16" fill="#fff" font-family="sans-serif">${f.replace('.png', '')}</text></svg>`);
  const tile = await sharp(img).composite([{ input: label, top: 0, left: 0 }]).toBuffer();
  return { input: tile, left: (i % cols) * S, top: Math.floor(i / cols) * S };
}));
await sharp({ create: { width: cols * S, height: rows * S, channels: 3, background: '#222' } }).composite(comps).png().toFile(process.argv[2]);
console.log(files.length, 'thumbnails');
