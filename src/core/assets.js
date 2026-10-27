import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Target real-world sizes (metres) for the Meshy models, plus optional glow treatment.
// `glow`: emissive taken from bright texels (lamps, windows). `shine`: whole surface glows.
export const ASSETS = {
  giovanni: { char: true, height: 1.45 },
  campanella: { char: true, height: 1.47 },
  birdcatcher: { char: true, height: 1.78 },
  keeper: { char: true, height: 1.72 },
  kaoru: { char: true, height: 1.28 },
  conductor: { char: true, height: 1.86 },
  locomotive: { length: 8.4, glow: { t: 0.55, i: 2.2 } },
  carriage: { length: 13.5, glow: { t: 0.5, i: 2.6 } },
  seat: { width: 1.45 },
  pillar: { height: 3.8 },
  streetlamp: { height: 3.6, glow: { t: 0.45, i: 4 } },
  station: { width: 10, glow: { t: 0.7, i: 1.2 } },
  fossil: { height: 0.42, shine: { c: 0xffe6b0, i: 0.35 } },
  heron: { width: 2.4, shine: { c: 0xdff4ff, i: 0.9 } },
  lighthouse: { height: 12 },
  appletree: { height: 5.2 },
  apple: { height: 0.3, shine: { c: 0xff5040, i: 0.6 } },
  scorpion: { length: 11, shine: { c: 0xff3b22, i: 1.4 } },
  cross: { height: 24, shine: { c: 0xcfe8ff, i: 0.7 } },
  crystals: { height: 1.3, shine: { c: 0x9fe6ff, i: 1.1 } },
  gentian: { height: 0.5, shine: { c: 0x5a6cff, i: 0.5 } },
  signal: { height: 3.4, glow: { t: 0.55, i: 3 } },
};

export const CLIP = {
  idle: 'Idle', walk: 'Casual_Walk', run: 'Run_02', wave: 'Wave_One_Hand',
  pickup: 'Male_Bend_Over_Pick_Up', sit: 'Chair_Sit_Idle_M', talk: 'Talk_with_Hands_Open', bow: 'Formal_Bow',
};

const protos = {};
const clipsById = {};

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const ids = Object.keys(ASSETS);
  let done = 0;
  await Promise.all(ids.map(async (id) => {
    try {
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${id}.glb`);
      protos[id] = prepare(id, gltf.scene);
      clipsById[id] = gltf.animations.map(stripRootMotion);
    } catch (e) {
      console.warn('asset failed, using placeholder', id, e);
      protos[id] = placeholder(id);
      clipsById[id] = [];
    }
    onProgress?.(++done / ids.length);
  }));
}

function prepare(id, scene) {
  const info = ASSETS[id];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.asset = true; // shared with the prototype: never dispose per-area
    o.castShadow = true;
    o.receiveShadow = true;
    if (o.isSkinnedMesh) o.frustumCulled = false;
    const m = o.material;
    m.side = THREE.FrontSide;
    if (m.map) m.map.anisotropy = 4;
    if (info.glow) patchGlow(m, info.glow);
    if (info.shine) {
      m.emissive = new THREE.Color(info.shine.c);
      m.emissiveMap = m.map || null;
      m.emissiveIntensity = info.shine.i;
    }
  });
  const inner = new THREE.Group();
  inner.add(scene);
  const measure = () => {
    inner.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(inner, true);
  };
  let box = measure();
  let size = box.getSize(new THREE.Vector3());
  // Long props (train cars) are turned so their length runs along Z.
  if (info.length && size.x > size.z) {
    scene.rotation.y = Math.PI / 2;
    box = measure();
    size = box.getSize(new THREE.Vector3());
  }
  let s = 1;
  if (info.height) s = info.height / size.y;
  else if (info.length) s = info.length / size.z;
  else if (info.width) s = info.width / Math.max(size.x, size.z);
  inner.scale.setScalar(s);
  box = measure();
  const center = box.getCenter(new THREE.Vector3());
  inner.position.set(-center.x, -box.min.y, -center.z);
  const pivot = new THREE.Group();
  pivot.name = id;
  pivot.add(inner);
  pivot.userData.size = box.getSize(new THREE.Vector3());
  return pivot;
}

// Lets bright texels (window glass, lamp panes) emit light so bloom picks them up.
function patchGlow(material, { t, i }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlowT = { value: t };
    shader.uniforms.uGlowI = { value: i };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlowT; uniform float uGlowI;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float gl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float warm = clamp((diffuseColor.r + diffuseColor.g) * 0.5 - diffuseColor.b * 0.6, 0.0, 1.0);
        totalEmissiveRadiance += diffuseColor.rgb * smoothstep(uGlowT, uGlowT + 0.2, gl + warm * 0.5) * uGlowI;`);
  };
  material.customProgramCacheKey = () => `glow${t}_${i}`;
}

// Meshy clips can carry forward root motion; remove the drift so characters animate in place.
function stripRootMotion(clip) {
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    if (!/hips|root|pelvis/i.test(track.name)) continue;
    const v = track.values, n = v.length / 3, times = track.times;
    const dur = times[n - 1] - times[0] || 1;
    for (const axis of [0, 2]) {
      const drift = v[(n - 1) * 3 + axis] - v[axis];
      for (let k = 0; k < n; k++) v[k * 3 + axis] -= drift * ((times[k] - times[0]) / dur);
    }
  }
  return clip;
}

function placeholder(id) {
  const info = ASSETS[id];
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8899cc, roughness: 0.6 });
  const h = info.height || 1.5;
  const mesh = info.char
    ? new THREE.Mesh(new THREE.CapsuleGeometry(0.25, h - 0.5, 4, 8), mat)
    : new THREE.Mesh(new THREE.BoxGeometry(info.width || info.length || 1, h, info.length || 1), mat);
  mesh.position.y = h / 2;
  g.add(mesh);
  g.userData.size = new THREE.Vector3(1, h, 1);
  return g;
}

export function spawn(id) {
  const p = protos[id];
  const obj = ASSETS[id].char ? SkeletonUtils.clone(p) : p.clone(true);
  obj.userData.size = p.userData.size;
  return obj;
}

export function clips(id) {
  return clipsById[id] || [];
}

export function size(id) {
  return protos[id]?.userData.size || new THREE.Vector3(1, 1, 1);
}
