// Shrinks raw Meshy GLBs for the web: meshopt geometry + WebP textures, saved to public/models/.
// Characters use the rigged+animated file. Usage: node tools/optimize.mjs [assetId ...]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'assets-raw');
const OUT = path.join(ROOT, 'public/models');
const BIN = path.join(ROOT, 'node_modules/.bin/gltf-transform');
const SMALL = new Set(['apple', 'fossil', 'gentian', 'crystals', 'signal', 'streetlamp', 'seat', 'heron']);

fs.mkdirSync(OUT, { recursive: true });
const { assets } = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/assets.json'), 'utf8'));
const only = process.argv.slice(2);

for (const a of assets) {
  if (only.length && !only.includes(a.id)) continue;
  const src = path.join(RAW, a.kind === 'character' ? `${a.id}.anim.glb` : `${a.id}.glb`);
  if (!fs.existsSync(src)) { console.log(`skip ${a.id} (no raw file yet)`); continue; }
  const dst = path.join(OUT, `${a.id}.glb`);
  const size = a.kind === 'character' ? 1024 : SMALL.has(a.id) ? 512 : 1024;
  execFileSync(BIN, [
    'optimize', src, dst,
    '--compress', 'meshopt',
    '--texture-compress', 'webp',
    '--texture-size', String(size),
    '--simplify', 'false',
    '--flatten', 'false',
    '--join', 'false',
  ], { stdio: 'pipe' });
  const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0);
  console.log(`${a.id.padEnd(12)} ${kb(src).padStart(6)} KB -> ${kb(dst).padStart(5)} KB`);
}
