// Meshy asset pipeline: text-to-3D (meshy-t2.5 smart topology) -> PBR refine -> (rig + animate) -> download.
// Resumable: task ids are stored in tools/meshy-state.json, so re-running never re-buys finished stages.
// Usage: MESHY_API_KEY=... node tools/meshy.mjs [assetId ...]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

// Node's fetch ignores HTTPS_PROXY by default; honor it like curl does.
setGlobalDispatcher(new EnvHttpProxyAgent());

const KEY = process.env.MESHY_API_KEY;
if (!KEY) throw new Error('MESHY_API_KEY is not set');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'tools/assets.json');
const STATE = path.join(ROOT, 'tools/meshy-state.json');
const RAW = path.join(ROOT, 'assets-raw');
const API = 'https://api.meshy.ai/openapi';
const CONCURRENCY = 6;

const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
let state = {};
try { state = JSON.parse(await fs.readFile(STATE, 'utf8')); } catch {}
await fs.mkdir(RAW, { recursive: true });

let saving = Promise.resolve();
const save = () => (saving = saving.then(() => fs.writeFile(STATE, JSON.stringify(state, null, 2))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (id, ...m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${id.padEnd(12)}`, ...m);

async function api(method, url, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + url, {
      method,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 8) { await sleep(5000 * (attempt + 1)); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text}`);
    return JSON.parse(text);
  }
}

async function poll(id, url) {
  let last = -1;
  for (;;) {
    let t;
    try { t = await api('GET', url); } catch (e) { log(id, 'poll error', e.message); await sleep(10000); continue; }
    if (t.progress !== last) { log(id, url.split('/')[2], t.status, `${t.progress}%`); last = t.progress; }
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${url} ${t.status}: ${JSON.stringify(t.task_error)}`);
    await sleep(8000);
  }
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
}

async function stage(s, key, create, url, id) {
  if (!s[key]) { s[key] = (await create()).result; await save(); log(id, `${key} created`, s[key]); }
  try { return await poll(id, url(s[key])); }
  catch (e) { delete s[key]; await save(); throw e; } // failed tasks are refunded; next run recreates
}

async function build(asset) {
  const id = asset.id;
  const s = (state[id] ??= {});
  const isChar = asset.kind === 'character';

  await stage(s, 'preview', () => api('POST', '/v2/text-to-3d', {
    mode: 'preview',
    prompt: `${asset.prompt}, ${manifest.style}`.slice(0, 800),
    model_type: 'smart-topology',
    ai_model: 'meshy-t2.5',
    target_polycount: asset.polycount,
    pose_mode: isChar ? 'a-pose' : '',
    target_formats: ['glb'],
  }), (t) => `/v2/text-to-3d/${t}`, id);

  const refine = await stage(s, 'refine', () => api('POST', '/v2/text-to-3d', {
    mode: 'refine',
    preview_task_id: s.preview,
    enable_pbr: true,
    texture_resolution: '2k',
    texture_prompt: `${asset.texture}, ${manifest.texture_style}`.slice(0, 800),
    target_formats: ['glb'],
  }), (t) => `/v2/text-to-3d/${t}`, id);

  const glb = path.join(RAW, `${id}.glb`);
  await download(refine.model_urls.glb, glb);
  if (refine.thumbnail_url) await download(refine.thumbnail_url, path.join(RAW, `${id}.png`));
  log(id, 'model downloaded');

  if (isChar) {
    const rig = await stage(s, 'rig', () => api('POST', '/v1/rigging', {
      input_task_id: s.refine,
      height_meters: asset.height,
    }), (t) => `/v1/rigging/${t}`, id);
    await download(rig.result.rigged_character_glb_url, path.join(RAW, `${id}.rigged.glb`));

    const anim = await stage(s, 'anim', () => api('POST', '/v1/animations', {
      rig_task_id: s.rig,
      action_ids: asset.anims,
    }), (t) => `/v1/animations/${t}`, id);
    await download(anim.result.animation_glb_url, path.join(RAW, `${id}.anim.glb`));
    log(id, 'rig + animations downloaded');
  }
  s.done = true;
  await save();
}

const only = process.argv.slice(2);
const queue = manifest.assets.filter((a) => (only.length ? only.includes(a.id) : !state[a.id]?.done));
const failed = [];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let a; (a = queue.shift());) {
    try { await build(a); } catch (e) { failed.push(a.id); log(a.id, 'FAILED', e.message); }
  }
}));
await save();
const bal = await api('GET', '/v1/balance');
console.log(failed.length ? `Failed: ${failed.join(', ')}` : 'All assets done.', `Balance: ${bal.balance}`);
