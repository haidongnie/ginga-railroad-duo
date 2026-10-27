import * as THREE from 'three';
import { spawn } from '../core/assets.js';
import { isTouch } from '../core/renderer.js';
import { createGround, createGrass, createRiver, createMotes, createRing, createBeam } from './nature.js';
import { createTrack, Train } from './train.js';
import { Character } from '../game/character.js';
import { fbm2, rng } from './noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = isTouch ? 0.5 : 1; // density scale for grass and particles on phones
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const faceTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);

export function buildArea(name) {
  return BUILDERS[name]();
}

// ---------------------------------------------------------------- shared helpers

function base({ fog = 0x070b1f, density = 0.011, hemi = [0x5a70c8, 0x080a14, 0.85], moon = [0x9fb8ff, 1.4], moonDir = [-0.45, 1, 0.4] } = {}) {
  const group = new THREE.Group();
  const hemiL = new THREE.HemisphereLight(hemi[0], hemi[1], hemi[2]);
  const sun = new THREE.DirectionalLight(moon[0], moon[1]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
  const c = sun.shadow.camera;
  c.left = -20; c.right = 20; c.top = 20; c.bottom = -20; c.near = 1; c.far = 120;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.intensity = 0.75;
  group.add(hemiL, sun, sun.target);
  return {
    group, sun,
    sunDir: V(...moonDir).normalize(),
    fog: new THREE.FogExp2(fog, density),
    envIntensity: 0.55,
    items: [], npcs: {}, points: {}, obstacles: [], updaters: [], spawns: [],
    height: () => 0,
    walkable: () => true,
    camMax: 9,
    camClamp: null,
    camBlocks: [], // boxes the camera may not enter (parked trains)
    trainSound: false,
    dawn: 0,
    coalsack: null,
    onStep() {},
    update(dt, t, ctx) { for (const u of this.updaters) u(dt, t, ctx); },
    dispose() {
      group.traverse((o) => {
        if (o.userData.asset) return;
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) { m.map?.userData?.own && m.map.dispose(); m.dispose(); }
      });
      for (const n of Object.values(this.npcs)) n.dispose();
      group.removeFromParent();
    },
  };
}

function put(a, id, x, z, { rot = 0, s = 1, y, obstacle } = {}) {
  const o = spawn(id);
  o.position.set(x, y ?? a.height(x, z), z);
  o.rotation.y = rot;
  o.scale.multiplyScalar(s);
  a.group.add(o);
  if (obstacle) a.obstacles.push({ x, z, r: obstacle });
  return o;
}

function live(a, obj) {
  a.group.add(obj);
  if (obj.userData.update) a.updaters.push((dt, t) => obj.userData.update(t));
  return obj;
}

function npc(a, id, x, z, rot, label) {
  const c = new Character(id, { label, color: '#cfe0ff' });
  c.root.position.set(x, a.height(x, z), z);
  c.root.rotation.y = rot;
  a.group.add(c.root);
  a.npcs[id] = c;
  a.updaters.push((dt) => c.update(dt));
  a.obstacles.push({ x, z, r: 0.45 });
  return c;
}

function light(a, color, intensity, distance, x, y, z) {
  const l = new THREE.PointLight(color, intensity, distance, 1.6);
  l.position.set(x, y, z);
  a.group.add(l);
  return l;
}

function lamp(a, x, z, rot = 0, withLight = true) {
  put(a, 'streetlamp', x, z, { rot, obstacle: 0.25 });
  if (withLight) light(a, 0xffc070, 9, 14, x, a.height(x, z) + 3.3, z);
}

// Many copies of one Meshy prop as InstancedMeshes (one draw call per sub-mesh).
function scatter(a, id, placements) {
  const proto = spawn(id);
  proto.updateMatrixWorld(true);
  const m = new THREE.Matrix4();
  proto.traverse((o) => {
    if (!o.isMesh) return;
    const inst = new THREE.InstancedMesh(o.geometry, o.material, placements.length);
    inst.userData.asset = true;
    placements.forEach((p, i) => {
      m.compose(V(p.x, p.y ?? a.height(p.x, p.z), p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.rot || 0, 0)), V(p.s || 1, p.s || 1, p.s || 1));
      inst.setMatrixAt(i, m.multiply(o.matrixWorld));
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    a.group.add(inst);
  });
}

// Twinkling glitter scattered on the ground (quartz sand, dew).
function glitter(a, count, box, color = 0xcfefff, size = 3) {
  const r = rng(99);
  const pos = new Float32Array(count * 3), ph = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = box[0] + r() * (box[2] - box[0]), z = box[1] + r() * (box[3] - box[1]);
    pos.set([x, a.height(x, z) + 0.04, z], i * 3);
    ph[i] = r() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uSize: { value: size * Math.min(devicePixelRatio, 2) } },
    vertexShader: `attribute float phase; uniform float uTime; uniform float uSize; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        vA = pow(max(0.0, sin(uTime * (1.0 + fract(phase) * 2.0) + phase)), 6.0);
        gl_PointSize = uSize * (0.4 + vA) * (12.0 / -mv.z); }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uColor * smoothstep(0.5, 0.0, d) * (0.15 + vA * 2.0), 1.0); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.update = (t) => { mat.uniforms.uTime.value = t; };
  return live(a, pts);
}

// A parked train on a straight north-south track; its middle carriage door becomes the `door` point.
function stationTrain(a, trackX, doorZ = 0, side = 1, groundY = 0) {
  const curve = new THREE.CatmullRomCurve3([V(trackX, 0, -240), V(trackX, 0, -80), V(trackX, 0, 80), V(trackX, 0, 240)]);
  a.group.add(createTrack(curve));
  const train = new Train();
  train.setCurve(curve);
  a.group.add(train.group);
  const loco = train.cars[0].len, car = train.cars[1].len;
  train.place(240 + doorZ + loco + 0.7 + car / 2);
  a.train = train;
  a.camBlocks.push({ x0: trackX - 2.1, x1: trackX + 2.1, z0: doorZ - 40, z1: doorZ + 30, y1: 5.2 });
  a.updaters.push((dt, t) => train.update(dt, t, false));
  const door = train.door(1, side);
  door.y = groundY;
  a.points.door = door;
  const ring = live(a, createRing(1.1, 0xf4d58d));
  ring.position.set(door.x + side * 0.6, groundY + 0.03, door.z);
  return train;
}

function sign(a, text, sub, x, z, rot) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#f2ead6'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#2d4a52'; g.lineWidth = 10; g.strokeRect(5, 5, 502, 150);
  g.fillStyle = '#1d2f36'; g.textAlign = 'center';
  g.font = '600 64px "Songti SC","Noto Serif SC",serif'; g.fillText(text, 256, 82);
  g.font = 'italic 28px Georgia,serif'; g.fillText(sub, 256, 130);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.own = true;
  // Two single-sided faces so the lettering reads correctly from both sides.
  const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0xffe8c0, emissiveMap: tex, emissiveIntensity: 0.35 });
  const y = a.height(x, z);
  for (const flip of [0, Math.PI]) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), faceMat);
    board.position.set(x, y + 2.1, z);
    board.rotation.y = rot + flip;
    a.group.add(board);
  }
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2d4a52, roughness: 0.6 });
  for (const d of [-1.05, 1.05]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5), postMat);
    post.position.set(x + Math.cos(rot) * d, y + 1.25, z - Math.sin(rot) * d);
    post.castShadow = true;
    a.group.add(post);
  }
  a.obstacles.push({ x, z, r: 0.6 });
}

function item(a, def) {
  const it = { r: 1.7, anim: 'pickup', hideOnCollect: true, active: true, ...def };
  if (it.obj) {
    a.group.add(it.obj);
    if (!it.noRing) {
      const ring = createRing(0.45, it.ringColor || 0x9fe6ff);
      ring.position.set(it.pos.x, it.pos.y + 0.03, it.pos.z);
      it.ring = live(a, ring);
    }
  }
  a.items.push(it);
  return it;
}

function placeSpaced(r, n, minD, gen) {
  const out = [];
  for (let tries = 0; out.length < n && tries < 4000; tries++) {
    const p = gen(r);
    if (out.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > minD)) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- areas

const BUILDERS = {
  hill: () => hill(false),
  dawn: () => hill(true),
  carriage,
  swan,
  birds,
  apples,
  scorpion,
  cross,
};

function hill(dawn) {
  const a = dawn
    ? base({ fog: 0x4a3b58, density: 0.007, hemi: [0xffc4a0, 0x2a2440, 1.3], moon: [0xffb27a, 2.0], moonDir: [0.7, 0.35, -0.6] })
    : base({ fog: 0x070b1f, density: 0.009, hemi: [0x5a70c8, 0x080a14, 0.8], moon: [0x9fb8ff, 1.4], moonDir: [-0.4, 1, 0.5] });
  a.dawn = dawn ? 1 : 0;
  const pathX = (z) => 3 * Math.sin(z * 0.08);
  const onPath = (x, z) => z > 2 && z < 60 && Math.abs(x - pathX(z)) < 1.1;
  const H = (x, z) => {
    const r2 = x * x + z * z, r = Math.sqrt(r2);
    return 9 * Math.exp(-r2 / (2 * 17 * 17)) + 1.6 * (fbm2(x * 0.04 + 3, z * 0.04 + 1) - 0.5) + smooth(110, 280, r) * 30;
  };
  a.height = H;
  a.walkable = (x, z) => x * x + z * z < 56 * 56;
  const top = H(0, 0);
  a.points.pillar = V(0, top, 0);

  const ground = createGround({
    size: 620, seg: 230, height: H,
    color: (x, z, h, c) => {
      const n = fbm2(x * 0.15, z * 0.15);
      if (onPath(x, z)) c.setRGB(0.11, 0.095, 0.08);
      else if (dawn) c.setRGB(0.09 + n * 0.05, 0.13 + n * 0.06, 0.10);
      else c.setRGB(0.025 + n * 0.02, 0.06 + n * 0.035, 0.075 + n * 0.03);
    },
  });
  a.group.add(ground);
  live(a, createGrass({
    count: 30000 * Q, area: [-56, -56, 56, 56], height: H, seed: 2, bladeH: [0.25, 0.65],
    base: dawn ? 0x1d3a26 : 0x0a1d26, tip: dawn ? 0x8fb07a : 0x3b6c86, glowTips: dawn ? 0 : 0.12,
    filter: (x, z) => x * x + z * z < 56 * 56 && !onPath(x, z) && x * x + z * z > 3,
  }));
  live(a, createGrass({
    count: 4000 * Q, area: [-60, -60, 60, 60], height: H, seed: 3, bladeH: [0.9, 1.6],
    base: 0x1a2a3a, tip: dawn ? 0xffe0c0 : 0xb8d4f0, glowTips: dawn ? 0.2 : 0.5,
    filter: (x, z) => { const r = Math.hypot(x, z); return r > 16 && r < 58 && !onPath(x, z) && Math.abs(x - pathX(z)) > 2.5; },
  }));

  put(a, 'pillar', 0, 0, { obstacle: 0.8 });
  const ring = live(a, createRing(2.6, 0xbfe6ff));
  ring.position.set(0, top + 0.05, 0);
  ring.visible = !dawn;
  const pillarLight = light(a, 0xbfe6ff, 0, 18, 0, top + 4.2, 0);
  [[44, -1.8], [34, 1.8], [24, -1.8], [14, 1.8]].forEach(([z, dx], i) => lamp(a, pathX(z) + dx, z, 0, !dawn && i % 2 === 1));

  // The town below, its river full of festival lanterns.
  live(a, createRiver({ width: 26, length: 360, position: [0, -140], rotation: Math.PI / 2, y: 1.5, flow: 0.5, color1: 0x0a1640, color2: dawn ? 0x8fb0ff : 0x6f9cff }));
  live(a, createMotes({ count: 160 * Q, box: [-90, 2, -152, 90, 40, -125], color: 0xffa858, size: 16, rise: 0.5, seed: 4 }));
  const town = new Float32Array(500 * 3);
  const tr = rng(5);
  for (let i = 0; i < 500; i++) town.set([(tr() - 0.5) * 200, 2 + tr() * 8, -165 - tr() * 40], i * 3);
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(town, 3));
  a.group.add(new THREE.Points(tg, new THREE.PointsMaterial({ color: new THREE.Color(0xffc070).multiplyScalar(3), size: 0.9, sizeAttenuation: true, fog: false })));
  if (!dawn) live(a, createMotes({ count: 220 * Q, box: [-40, top - 6, -40, 40, top + 10, 40], color: 0x9fe6ff, size: 7, rise: 0.15 }));

  a.spawns = dawn ? [[1.5, 3, Math.PI * 0.8], [3.2, 2.2, Math.PI * 0.8]] : [[-0.6, 47, Math.PI], [1.2, 47.5, Math.PI]];

  if (!dawn) {
    // The galactic railway descends out of the sky and stops beside the summit.
    const curve = new THREE.CatmullRomCurve3([
      V(-120, 70, -210), V(-40, 40, -125), V(4, 18, -52), V(7.5, top + 0.6, -14), V(7.5, top + 0.4, 0),
      V(7.5, top + 0.6, 14), V(12, 18, 52), V(50, 40, 125), V(130, 70, 210),
    ], false, 'centripetal');
    const track = createTrack(curve, { sleepers: true });
    a.group.add(track);
    const train = new Train();
    train.setCurve(curve);
    a.group.add(train.group);
    a.train = train;
    let best = 0, bestD = 1e9;
    const p = V();
    for (let i = 0; i <= 2000; i++) {
      curve.getPointAt(i / 2000, p);
      const d = Math.hypot(p.x - 7.5, p.z);
      if (d < bestD) { bestD = d; best = i / 2000; }
    }
    const stopS = best * train.L + train.cars[0].len + 0.7 + train.cars[1].len / 2;
    const setVisible = (v) => { track.visible = v; train.group.visible = v; };
    let anim = null;
    setVisible(false);
    a.updaters.push((dt, t) => {
      if (anim) {
        anim.t += dt;
        const k = Math.min(1, anim.t / anim.dur);
        train.place(THREE.MathUtils.lerp(anim.from, stopS, 1 - Math.pow(1 - k, 3)));
        if (k >= 1) anim = null;
      }
      if (train.group.visible) train.update(dt, t, !!anim);
    });
    train.place(stopS);
    const door = train.door(1, -1);
    door.y = H(door.x, door.z);
    a.points.door = door;
    a.onStep = (step, reached, fresh) => {
      const arrived = reached('trainArrive');
      ring.userData.setOn(arrived ? 1 : 0);
      pillarLight.intensity = arrived ? 25 : 0;
      if (step.id === 'trainArrive' && fresh) {
        setVisible(true);
        anim = { t: 0, dur: 7, from: 60 };
        train.place(60);
      } else if (arrived) {
        setVisible(true);
        if (!anim) train.place(stopS);
      }
    };
  }
  return a;
}

function carriage() {
  const a = base({ fog: 0x0a0e24, density: 0.006, hemi: [0x9aa6e0, 0x4a3420, 1.1], moon: [0xcfe0ff, 0.9], moonDir: [0.6, 0.8, 0.2] });
  a.trainSound = true;
  a.narrow = true;
  a.camMax = 3.4;
  a.envIntensity = 0.4;
  const W = 3.0, L = 16, H = 2.75;
  a.walkable = (x, z) => Math.abs(x) < 1.3 && z > -7.6 && z < 7.75;
  a.camClamp = (v) => { v.x = THREE.MathUtils.clamp(v.x, -1.35, 1.35); v.y = THREE.MathUtils.clamp(v.y, 0.4, 2.55); v.z = THREE.MathUtils.clamp(v.z, -7.8, 7.85); };

  const wood = new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.55, metalness: 0.0 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x174a4c, roughness: 0.5 });
  const cream = new THREE.MeshStandardMaterial({ color: 0x9c8466, roughness: 0.85 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc89b4a, metalness: 0.9, roughness: 0.3 });
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    a.group.add(m);
    return m;
  };
  box(W + 0.2, 0.1, L + 0.2, wood, 0, -0.05, 0);
  box(W + 0.2, 0.1, L + 0.2, cream, 0, H + 0.05, 0);
  const winZ = [];
  for (let k = 0; k < 9; k++) winZ.push(-7.2 + 0.9 + k * 1.7);
  for (const s of [-1, 1]) {
    const x = s * (W / 2 + 0.04);
    box(0.08, 1.0, L, teal, x, 0.5, 0);
    box(0.08, 0.55, L, cream, x, H - 0.275, 0);
    box(0.1, 0.06, L, brass, x - s * 0.03, 1.02, 0);
    const edges = [-L / 2, ...winZ.flatMap((z) => [z - 0.6, z + 0.6]), L / 2];
    for (let i = 0; i < edges.length; i += 2) {
      const w = edges[i + 1] - edges[i];
      if (w > 0.01) box(0.08, 1.2, w, teal, x, 1.6, (edges[i] + edges[i + 1]) / 2);
    }
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(L, 1.2), new THREE.MeshStandardMaterial({ color: 0x9fc0ff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.2, depthWrite: false }));
    glass.position.set(x - s * 0.02, 1.6, 0);
    glass.rotation.y = s * Math.PI / 2;
    a.group.add(glass);
    const rack = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, L - 0.4), brass);
    rack.rotation.x = Math.PI / 2;
    rack.position.set(s * 1.25, 2.35, 0);
    a.group.add(rack);
  }
  box(W, H, 0.1, teal, 0, H / 2, -L / 2 - 0.05);
  // Front wall with the exit door.
  box(0.9, H, 0.1, teal, -1.05, H / 2, L / 2 + 0.05);
  box(0.9, H, 0.1, teal, 1.05, H / 2, L / 2 + 0.05);
  box(1.2, 0.6, 0.1, teal, 0, H - 0.3, L / 2 + 0.05);
  const doorPanel = box(1.1, 2.1, 0.06, new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.5 }), 0, 1.05, L / 2 + 0.1);
  const doorWin = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.7), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd890).multiplyScalar(2.5) }));
  doorWin.position.set(0, 1.55, L / 2 + 0.065);
  doorWin.rotation.y = Math.PI;
  a.group.add(doorWin);
  doorPanel.castShadow = false;

  // Ceiling lamps.
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(5) });
  for (const z of [-6, -2, 2, 6]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), bulbMat);
    b.position.set(0, H - 0.15, z);
    a.group.add(b);
    box(0.3, 0.04, 0.3, brass, 0, H - 0.02, z);
  }
  for (const z of [-4.5, 0.5, 5.5]) light(a, 0xffc98a, 7, 9, 0, H - 0.45, z);

  // Velvet seats facing each other in bays. The Meshy bench is stretched upward so a seated
  // child's feet reach the floor. Each seat records where the hips go (window half of the
  // cushion) and an aisle spot to stand back up to; facing seats are partners.
  const seatS = 1.1 / 1.45, seatLift = 1.6;
  const probe = new THREE.Raycaster();
  let cushionY = null;
  let n = 0;
  for (const zc of [-5.5, -2.1, 1.3]) {
    for (const sx of [-0.92, 0.92]) {
      const pair = [];
      for (const [dz, rot] of [[-0.78, 0], [0.78, Math.PI]]) {
        const z = zc + dz, f = Math.cos(rot); // f = +1 faces +z, -1 faces -z
        const bench = put(a, 'seat', sx, z, { rot, s: seatS, y: 0 });
        bench.scale.y *= seatLift;
        if (cushionY === null) {
          bench.updateMatrixWorld(true);
          probe.set(V(sx, 3, z + f * 0.05), V(0, -1, 0));
          cushionY = probe.intersectObject(bench, true)[0]?.point.y ?? 0.35;
        }
        // Collision hugs the bench (inner edge at |x| = 0.37) so the aisle stays ~0.6 m walkable.
        a.obstacles.push({ x: Math.sign(sx) * 1.0, z: z - f * 0.1, r: 0.42 });
        const seat = { id: `seat${n}`, y: cushionY, hipX: sx + Math.sign(sx) * 0.26, hipZ: z + f * 0.15, yaw: rot, standX: Math.sign(sx) * 0.1, standZ: z + f * 0.55 };
        pair.push(seat);
        item(a, { id: `seat${n++}`, group: 'sit', kind: 'sit', label: '坐下', r: 0.9, pos: V(sx * 0.45, 0, z + f * 0.5), seat });
      }
      pair[0].partner = pair[1];
      pair[1].partner = pair[0];
    }
  }

  const cond = npc(a, 'conductor', 0, 6.4, Math.PI, '列车长');
  item(a, { id: 'conductor', group: 'npc', label: '出示车票', r: 2.2, anim: 'none', pos: cond.root.position.clone() });
  a.points.door = V(0, 0, 7.5);

  // The world rushing past the windows.
  const speed = 16;
  const flow = createGrass({ count: 9000 * Q, area: [-90, -150, -6, 150], height: () => -2.2, seed: 8, bladeH: [1.0, 2.0], base: 0x1b2b44, tip: 0xc8dcf4, glowTips: 0.8, wrap: true });
  live(a, flow);
  const river = live(a, createRiver({ width: 160, length: 420, position: [86, 0], y: -2.5, flow: 9 }));
  river.material.uniforms.uFlow.value = 9;
  const markers = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true }), 120);
  const mr = rng(12);
  const mk = [];
  const palette = [0x6fb8ff, 0xffb46b, 0x7dffb0, 0xff8fb8, 0xbfe0ff];
  for (let i = 0; i < 120; i++) {
    const side = mr() < 0.5 ? -1 : 1;
    mk.push({ x: side * (8 + mr() * 70), y: -1 + mr() * 5, z: -200 + mr() * 400, s: 0.6 + mr() * 1.6 });
    markers.setColorAt(i, new THREE.Color(palette[i % palette.length]).multiplyScalar(4));
  }
  a.group.add(markers);
  const mm = new THREE.Matrix4(), mq = new THREE.Quaternion(), ms = V();
  let scroll = 0;
  a.updaters.push((dt, t) => {
    scroll += dt * speed;
    mk.forEach((m, i) => {
      const z = ((m.z - scroll) % 400 + 400) % 400 - 200;
      mq.setFromEuler(new THREE.Euler(0, t + i, 0));
      mm.compose(ms.set(m.x, m.y, z), mq, V(m.s * 0.5, m.s, m.s * 0.5));
      markers.setMatrixAt(i, mm);
    });
    markers.instanceMatrix.needsUpdate = true;
    flow.userData.scroll(scroll);
  });
  a.spawns = [[-0.18, -7.1, 0], [0.18, -7.1, 0]]; // side by side in the aisle, clear of the seats
  return a;
}

function plankTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    const l = 30 + Math.random() * 14;
    g.fillStyle = `hsl(25,45%,${l * 0.5}%)`;
    g.fillRect(i * 32, 0, 32, 512);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(i * 32, 0, 2, 512);
    for (let k = 0; k < 30; k++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
      g.fillRect(i * 32 + Math.random() * 30, Math.random() * 512, 1, 40 + Math.random() * 80);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.5, 4);
  tex.userData.own = true;
  return tex;
}

function swan() {
  const a = base({ fog: 0x081030, density: 0.011 });
  const trackX = -6.2, PX0 = -4.2, PX1 = 3.2, PY = 0.4;
  const onPlatform = (x, z) => x >= PX0 && x <= PX1 && Math.abs(z) <= 24;
  const sand = (x, z) => 0.3 * (fbm2(x * 0.08, z * 0.08) - 0.4) + 0.25 * Math.sin(x * 0.18 + z * 0.05) * smooth(6, 14, x) - smooth(34, 46, x) * 2.2;
  a.height = (x, z) => (onPlatform(x, z) ? PY : x < PX0 ? 0 : sand(x, z) * smooth(PX1, PX1 + 3, x));
  a.walkable = (x, z) => x > PX0 + 0.3 && x < 44 && Math.abs(z) < 34 && (x > PX1 || Math.abs(z) < 24);

  a.group.add(createGround({
    size: 360, seg: 200, center: [60, 0], height: (x, z) => (x < PX1 + 0.5 && Math.abs(z) < 24 ? Math.min(0, sand(x, z)) : a.height(x, z)),
    color: (x, z, h, c) => { const n = fbm2(x * 0.2, z * 0.2); c.setRGB(0.22 + n * 0.1, 0.27 + n * 0.1, 0.38 + n * 0.1); },
    roughness: 0.75,
  }));
  const plat = new THREE.Mesh(new THREE.BoxGeometry(PX1 - PX0, PY, 48), new THREE.MeshStandardMaterial({ color: 0x4d5263, roughness: 0.85 }));
  plat.position.set((PX0 + PX1) / 2, PY / 2, 0);
  plat.receiveShadow = true;
  a.group.add(plat);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.02, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf4d58d).multiplyScalar(1.5) }));
  edge.position.set(PX0 + 0.35, PY + 0.01, 0);
  a.group.add(edge);

  stationTrain(a, trackX, 0, 1, PY);
  put(a, 'station', -0.5, -13, { rot: Math.PI / 2, s: 0.72, obstacle: 3.4 });
  lamp(a, 2.6, 7);
  lamp(a, 2.6, -5, 0, false);
  lamp(a, 2.6, 18, 0, false);
  put(a, 'signal', -9.5, 26, { rot: Math.PI });
  sign(a, '天鹅站', 'Swan Station', 2.4, 2.5, -Math.PI / 2);
  sign(a, '普利奥新海岸', 'Pliocene Coast', 9, 6, -Math.PI / 2);

  live(a, createRiver({ width: 120, length: 420, position: [100, 0], y: -1.4, flow: 1.2 }));
  glitter(a, 5000 * Q, [PX1 + 1, -34, 44, 34], 0xd8f4ff, 4);
  live(a, createMotes({ count: 260 * Q, box: [5, -1, -40, 80, 14, 40], color: 0x9fe6ff, size: 8 }));
  const r = rng(21);
  scatter(a, 'crystals', placeSpaced(r, 14, 5, (r) => ({ x: 8 + r() * 34, z: -32 + r() * 64, rot: r() * 6.3, s: 0.6 + r() * 1.2 })));
  scatter(a, 'gentian', placeSpaced(r, 60, 1.2, (r) => ({ x: 5 + r() * 30, z: -32 + r() * 64, rot: r() * 6.3, s: 0.7 + r() * 0.8 })));
  light(a, 0x8fe3ff, 10, 30, 30, 2, 0);

  const fr = rng(31);
  placeSpaced(fr, 6, 7, (r) => ({ x: 10 + r() * 26, z: -24 + r() * 48 })).forEach((p, i) => {
    const obj = spawn('fossil');
    const y = a.height(p.x, p.z);
    obj.position.set(p.x, y - 0.08, p.z);
    obj.rotation.set(0.3, fr() * 6, 0.2);
    item(a, { id: `fossil${i}`, group: 'fossil', label: '拾起胡桃化石', pos: V(p.x, y, p.z), obj, ringColor: 0xffe6b0 });
  });
  a.spawns = [[-2.6, -0.8, Math.PI / 2], [-2.6, 0.9, Math.PI / 2]];
  return a;
}

function birds() {
  const a = base({ fog: 0x0a0f2a, density: 0.010 });
  const trackX = -14;
  a.height = (x, z) => (x < -11.5 ? 0 : (0.6 * (fbm2(x * 0.05, z * 0.05) - 0.4) + 0.4 * Math.sin(x * 0.07) * Math.cos(z * 0.05)) * smooth(-11.5, -7, x) - smooth(38, 50, x) * 2);
  a.walkable = (x, z) => x > -11.6 && x < 44 && Math.abs(z) < 38;
  a.group.add(createGround({
    size: 360, seg: 200, center: [40, 0], height: a.height,
    color: (x, z, h, c) => { const n = fbm2(x * 0.1, z * 0.1); c.setRGB(0.05 + n * 0.04, 0.08 + n * 0.05, 0.12 + n * 0.05); },
  }));
  stationTrain(a, trackX, 0, 1, 0);
  const catcherAt = V(10, 0, 2);
  const clear = (x, z) => Math.hypot(x - catcherAt.x, z - catcherAt.z) > 3 && fbm2(x * 0.06 + 9, z * 0.06) < 0.5;
  live(a, createGrass({ count: 9000 * Q, area: [-10, -40, 44, 40], height: a.height, seed: 11, bladeH: [0.8, 1.4], base: 0x16243a, tip: 0xa8c4e0, glowTips: 0.45, filter: clear }));
  live(a, createGrass({ count: 16000 * Q, area: [-10, -40, 44, 40], height: a.height, seed: 12, bladeH: [0.2, 0.45], base: 0x0b1d26, tip: 0x3b6c86, glowTips: 0.1 }));
  live(a, createRiver({ width: 120, length: 420, position: [100, 0], y: -1.3 }));
  live(a, createMotes({ count: 300 * Q, box: [-10, 0, -40, 60, 12, 40], color: 0xbfe6ff, size: 7 }));
  lamp(a, -9.5, 6);
  sign(a, '芒草原', 'Pampas Field', -8.5, -4, -Math.PI / 2);

  const catcher = npc(a, 'birdcatcher', catcherAt.x, catcherAt.z, faceTo(catcherAt.x, catcherAt.z, -10, 0), '捕鸟人');
  catcher.play('talk');
  item(a, { id: 'birdcatcher', group: 'npc', label: '和捕鸟人说话', r: 2.6, anim: 'wave', pos: catcher.root.position.clone() });

  // Herons: circle high until the hunt starts, then spiral down to their landing spots.
  const hr = rng(41);
  const spots = placeSpaced(hr, 8, 5, (r) => {
    const ang = r() * Math.PI * 2, d = 7 + r() * 14;
    return { x: catcherAt.x + Math.cos(ang) * d, z: catcherAt.z + Math.sin(ang) * d };
  }).filter((p) => a.walkable(p.x, p.z));
  const herons = spots.map((p, i) => {
    const obj = spawn('heron');
    obj.scale.multiplyScalar(0.75);
    const it = item(a, { id: `heron${i}`, group: 'heron', label: '接住白鹭', pos: V(p.x, a.height(p.x, p.z), p.z), obj, r: 2.0, anim: 'wave', active: false, hideOnCollect: false, noRing: true });
    return { it, obj, p, delay: i * 2.2, phase: hr() * 6.28, gone: 0 };
  });
  const flock = [];
  for (let i = 0; i < 10; i++) {
    const o = spawn('heron');
    o.scale.multiplyScalar(0.6);
    a.group.add(o);
    flock.push({ o, r: 30 + hr() * 30, h: 22 + hr() * 14, ph: hr() * 6.28, sp: 0.08 + hr() * 0.06 });
  }
  let huntStart = -1, vanish = -1;
  a.onStep = (step, reached, fresh) => {
    if (reached('heron') && huntStart < 0) huntStart = fresh ? 0 : 999;
    if (step.id === 'catcherVanish') vanish = fresh ? 0 : 3;
    else if (reached('catcherVanish')) vanish = 3;
  };
  a.updaters.push((dt, t, ctx) => {
    for (const f of flock) {
      const ang = f.ph + t * f.sp;
      f.o.position.set(catcherAt.x + Math.cos(ang) * f.r, f.h + Math.sin(t + f.ph) * 2, catcherAt.z + Math.sin(ang) * f.r);
      f.o.rotation.set(0, -ang, 0.3 * Math.sin(t * 2 + f.ph));
    }
    if (huntStart >= 0) huntStart += dt;
    const caught = ctx?.fl?.heron || [];
    for (const h of herons) {
      const gy = h.it.pos.y;
      if (caught.includes(h.it.id)) {
        h.gone += dt;
        h.obj.position.y += dt * 6;
        h.obj.visible = h.gone < 3;
        h.it.active = false;
        continue;
      }
      const k = huntStart < 0 ? 0 : Math.max(0, Math.min(1, (huntStart - h.delay) / 9));
      const rad = THREE.MathUtils.lerp(24, 0.6, k);
      const ang = h.phase + t * THREE.MathUtils.lerp(0.25, 0.9, k);
      const y = THREE.MathUtils.lerp(28 + Math.sin(h.phase) * 4, gy + 1.0, k) + Math.sin(t * 2 + h.phase) * 0.25;
      h.obj.position.set(h.p.x + Math.cos(ang) * rad, y, h.p.z + Math.sin(ang) * rad);
      h.obj.rotation.set(0, -ang - Math.PI / 2 * (k < 1 ? 1 : 0.2), 0.25 * Math.sin(t * 3 + h.phase));
      h.it.active = k > 0.85;
      h.it.pos.copy(h.obj.position).setY(gy);
    }
    if (vanish >= 0) {
      vanish += dt;
      catcher.setOpacity(Math.max(0, 1 - vanish / 2.2));
    }
  });
  a.spawns = [[-10.5, -0.8, Math.PI / 2], [-10.5, 0.9, Math.PI / 2]];
  return a;
}

function apples() {
  const a = base({ fog: 0x0b1030, density: 0.010 });
  const trackX = -14;
  const LH = V(24, 0, -12);
  a.height = (x, z) => (x < -11.5 ? 0 : (0.5 * (fbm2(x * 0.05 + 4, z * 0.05) - 0.4) + 2.2 * Math.exp(-((x - LH.x) ** 2 + (z - LH.z) ** 2) / 90)) * smooth(-11.5, -7, x) - smooth(38, 50, x) * 2);
  a.walkable = (x, z) => x > -11.6 && x < 44 && Math.abs(z) < 36;
  a.group.add(createGround({
    size: 360, seg: 200, center: [40, 0], height: a.height,
    color: (x, z, h, c) => { const n = fbm2(x * 0.1, z * 0.1); const rock = smooth(1.2, 2.2, h); c.setRGB(0.05 + n * 0.04 + rock * 0.12, 0.09 + n * 0.05 + rock * 0.1, 0.10 + n * 0.04 + rock * 0.12); },
  }));
  stationTrain(a, trackX, 0, 1, 0);
  live(a, createGrass({ count: 22000 * Q, area: [-10, -36, 44, 36], height: a.height, seed: 21, bladeH: [0.2, 0.5], base: 0x0d2224, tip: 0x4a7f7a, glowTips: 0.1, filter: (x, z) => Math.hypot(x - LH.x, z - LH.z) > 5 }));
  live(a, createRiver({ width: 120, length: 420, position: [100, 0], y: -1.3 }));
  live(a, createMotes({ count: 220 * Q, box: [-10, 0, -36, 60, 14, 36], color: 0xfff0c0, size: 6 }));
  lamp(a, -9.5, 6);
  sign(a, '灯塔岬', 'Lighthouse Point', -8.5, -4, -Math.PI / 2);
  const r = rng(51);
  scatter(a, 'gentian', placeSpaced(r, 50, 1.4, (r) => ({ x: -8 + r() * 46, z: -34 + r() * 68, rot: r() * 6.3, s: 0.7 + r() * 0.7 })));

  put(a, 'lighthouse', LH.x, LH.z, { obstacle: 2.4 });
  const top = a.height(LH.x, LH.z) + 10.3;
  const lhLight = light(a, 0xffe2a0, 2, 30, LH.x + 2.5, top - 1, LH.z + 2.5);
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 12), new THREE.MeshBasicMaterial({ color: 0x3a2c18 }));
  lantern.position.set(LH.x, top, LH.z);
  a.group.add(lantern);
  const beamPivot = new THREE.Group();
  beamPivot.position.set(LH.x, top, LH.z);
  const beam = createBeam({ radius: 2.2, height: 70, color: 0xffe2a0, intensity: 0.7 });
  beam.rotation.z = -Math.PI / 2;
  beamPivot.add(beam);
  a.updaters.push((dt, t) => beam.userData.update(t));
  beamPivot.visible = false;
  a.group.add(beamPivot);

  const keeper = npc(a, 'keeper', 18.5, -6, faceTo(18.5, -6, 0, 0), '灯塔看守');
  const kaoru = npc(a, 'kaoru', 4, 6, faceTo(4, 6, -10, 0), '薰');
  keeper.play('talk');
  item(a, { id: 'kaoru', group: 'npc', label: '把苹果送给薰', r: 2.4, anim: 'wave', pos: kaoru.root.position.clone() });

  const trees = [[8, -16], [-3, -22], [14, 14], [-5, 18], [28, 10]];
  let n = 0;
  for (const [tx, tz] of trees) {
    put(a, 'appletree', tx, tz, { rot: r() * 6.3, s: 0.9 + r() * 0.3, obstacle: 0.9 });
    for (let k = 0; k < 2; k++) {
      const ang = r() * Math.PI * 2, d = 1.6 + r() * 1.2;
      const x = tx + Math.cos(ang) * d, z = tz + Math.sin(ang) * d;
      const obj = spawn('apple');
      const y = a.height(x, z);
      obj.position.set(x, y, z);
      item(a, { id: `apple${n++}`, group: 'apple', label: '拾起苹果', pos: V(x, y, z), obj, ringColor: 0xffb08a });
    }
  }
  const plates = [V(19.5, 0, -17.5), V(29.5, 0, -6.5)];
  ['plateA', 'plateB'].forEach((id, i) => {
    const p = plates[i];
    p.y = a.height(p.x, p.z);
    const ring = live(a, createRing(1.2, 0xf4d58d));
    ring.position.set(p.x, p.y + 0.05, p.z);
    a.points[id] = p;
    a.points[id + 'Ring'] = ring;
  });
  let lit = -1;
  a.onStep = (step, reached, fresh) => {
    if (reached('lighthouseOn')) {
      beamPivot.visible = true;
      lhLight.intensity = 14;
      lantern.material.color.setRGB(6, 5, 3);
      lit = fresh && step.id === 'lighthouseOn' ? 0 : 5;
    }
  };
  a.updaters.push((dt, t, ctx) => {
    beamPivot.rotation.y = t * 0.6;
    if (lit >= 0) { lit += dt; beam.userData.material.uniforms.uI.value = Math.min(1, lit / 2) * 0.8; }
    const step = ctx?.step;
    for (const id of ['plateA', 'plateB']) a.points[id + 'Ring'].userData.setOn(step?.type === 'plates' && ctx.occupied?.[id] ? 1 : 0);
  });
  a.spawns = [[-10.5, -0.8, Math.PI / 2], [-10.5, 0.9, Math.PI / 2]];
  return a;
}

function scorpion() {
  const a = base({ fog: 0x10060e, density: 0.011, hemi: [0x7a3048, 0x0a0408, 0.7], moon: [0xffb0a0, 0.9], moonDir: [0.3, 1, -0.4] });
  a.envIntensity = 1.0;
  const trackX = -24;
  a.height = () => 0;
  a.walkable = (x, z) => x > -21.6 && x < 38 && Math.abs(z) < 30;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x07060b, roughness: 0.16, metalness: 0.7 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  a.group.add(floor);
  stationTrain(a, trackX, 0, 1, 0);
  glitter(a, 4000 * Q, [-21, -30, 40, 30], 0xff9a7a, 3.5);
  live(a, createMotes({ count: 260 * Q, box: [-20, 0, -30, 50, 16, 30], color: 0xff7a5a, size: 7, rise: 0.3 }));
  live(a, createRiver({ width: 120, length: 420, position: [104, 0], y: -0.3, color1: 0x3a0a20, color2: 0xff8a6a }));
  lamp(a, -21, 6);

  // Distant fire across the river.
  const far = createBeam({ radius: 7, height: 140, color: 0xff3a1a, intensity: 0.9 });
  far.position.set(150, -5, 60);
  live(a, far);
  const farGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0xff4020).multiplyScalar(3), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  farGlow.scale.set(80, 80, 1);
  farGlow.position.set(150, 25, 60);
  a.group.add(farGlow);

  const stars = [[2, -18], [6, -13], [12, -17], [8, -7], [11, 5], [9, 11], [12, 16.5], [18.5, 17]];
  const starMat = () => new THREE.MeshBasicMaterial({ color: 0xff8060 });
  const nodes = stars.map(([x, z], i) => {
    const obj = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), starMat());
    obj.position.set(x, 1.0, z);
    return item(a, { id: `star${i}`, group: 'star', order: i, label: '点亮星', pos: V(x, 0, z), obj, r: 1.8, anim: 'wave', hideOnCollect: false, ringColor: 0xff7a5a });
  });
  const heart = V(10, 0, -1);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([...stars.slice(0, 4), [heart.x, heart.z], ...stars.slice(4)].map(([x, z]) => V(x, 0.9, z)));
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(0xff7050).multiplyScalar(3), transparent: true, opacity: 0.9 }));
  a.group.add(line);
  lineGeo.setDrawRange(0, 0);

  const statue = put(a, 'scorpion', 24, -3, { rot: -Math.PI / 2 - 0.4, y: 0 });
  a.obstacles.push({ x: 24, z: -3, r: 3.5 }, { x: 22, z: 1, r: 2.5 }, { x: 26, z: -7, r: 2.5 });
  const statueMats = [];
  statue.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); statueMats.push(o.material); } });
  const fireBeam = createBeam({ radius: 3.2, height: 90, color: 0xff3a1a, intensity: 0 });
  fireBeam.position.set(24, 0, -3);
  live(a, fireBeam);
  const fireLight = light(a, 0xff5030, 0, 60, 24, 6, -3);

  ['plateA', 'plateB'].forEach((id, i) => {
    const p = V(heart.x - 2.2 + i * 4.4, 0, heart.z);
    const ring = live(a, createRing(1.15, 0xff9a6a));
    ring.position.set(p.x, 0.05, p.z);
    a.points[id] = p;
    a.points[id + 'Ring'] = ring;
  });
  const heartStar = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial({ color: 0x401010 }));
  heartStar.position.set(heart.x, 1.4, heart.z);
  a.group.add(heartStar);

  let fire = -1;
  a.onStep = (step, reached, fresh) => {
    if (reached('fire')) fire = fresh && step.id === 'fire' ? 0 : 10;
  };
  a.updaters.push((dt, t, ctx) => {
    const lit = ctx?.fl?.star || [];
    nodes.forEach((n, i) => {
      const on = lit.includes(n.id);
      const next = i === lit.length && ctx?.step?.group === 'star';
      const k = on ? 4 : next ? 1.5 + Math.sin(t * 5) * 0.8 : 0.35;
      n.obj.material.color.setRGB(1.0 * k, 0.45 * k, 0.3 * k);
      n.obj.rotation.y = t * (on ? 2 : 0.5);
      n.obj.position.y = 1.0 + Math.sin(t * 2 + i) * 0.12;
    });
    const count = lit.length;
    lineGeo.setDrawRange(0, count > 4 ? count + 1 : count);
    const heartOn = fire >= 0;
    heartStar.material.color.setRGB(heartOn ? 6 : 0.5, heartOn ? 1.5 : 0.1, heartOn ? 0.8 : 0.08);
    heartStar.rotation.y = t;
    for (const id of ['plateA', 'plateB']) a.points[id + 'Ring'].userData.setOn(ctx?.step?.type === 'plates' && ctx.occupied?.[id] ? 1 : 0);
    if (fire >= 0) {
      fire += dt;
      const k = Math.min(1, fire / 3);
      fireBeam.userData.material.uniforms.uI.value = k * 1.2;
      fireLight.intensity = k * 120;
      for (const m of statueMats) m.emissiveIntensity = 1.4 + k * 3;
      if (count >= 8) lineGeo.setDrawRange(0, 9);
    }
  });
  a.spawns = [[-20.5, -0.8, Math.PI / 2], [-20.5, 0.9, Math.PI / 2]];
  return a;
}

function cross() {
  const a = base({ fog: 0x0a1030, density: 0.007, hemi: [0x7090ff, 0x0a0c18, 1.0], moon: [0xcfe0ff, 1.3], moonDir: [0.4, 1, 0.3] });
  const trackX = -30;
  const IS = V(40, 0, 0), IR = 9;
  const onBridge = (x, z) => x >= -2.5 && x <= 32 && Math.abs(z) < 1.45;
  const onIsland = (x, z) => (x - IS.x) ** 2 + z * z < (IR - 0.6) ** 2;
  const shoreH = (x, z) => (x < -27.5 ? 0 : (0.4 * (fbm2(x * 0.06, z * 0.06) - 0.4)) * smooth(-27.5, -24, x) - smooth(-3, 3, x) * 1.2);
  a.height = (x, z) => (onIsland(x, z) ? 0.3 : onBridge(x, z) && x > -1.5 ? 0.18 : shoreH(x, z));
  a.walkable = (x, z) => (x > -27.6 && x < -1 && Math.abs(z) < 38) || onBridge(x, z) || onIsland(x, z);
  a.coalsack = V(0.62, 0.42, -0.66).normalize();
  a.group.add(createGround({
    size: 300, seg: 160, center: [-40, 0], height: shoreH,
    color: (x, z, h, c) => { const n = fbm2(x * 0.1, z * 0.1); c.setRGB(0.06 + n * 0.04, 0.08 + n * 0.05, 0.14 + n * 0.06); },
  }));
  stationTrain(a, trackX, 0, 1, 0);
  live(a, createGrass({ count: 10000 * Q, area: [-27, -38, -2, 38], height: shoreH, seed: 61, bladeH: [0.8, 1.4], base: 0x16243a, tip: 0xa8c4e0, glowTips: 0.45, filter: (x, z) => Math.abs(z) > 3 || x < -12 }));
  live(a, createRiver({ width: 160, length: 420, position: [80, 0], y: -0.5, flow: 0.8, color1: 0x2a4cff, color2: 0xbff2ff }));
  live(a, createMotes({ count: 400 * Q, box: [-10, 0, -40, 80, 40, 40], color: 0xdff4ff, size: 8, rise: 0.8 }));
  lamp(a, -26.5, 6);
  sign(a, '南十字', 'Southern Cross', -26, -4, -Math.PI / 2);

  // Bridge of light.
  const plank = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.08, 2.9), new THREE.MeshStandardMaterial({ color: 0x9fe6ff, emissive: 0x6fcfff, emissiveIntensity: 1.6, roughness: 0.2 }), 56);
  const mm = new THREE.Matrix4();
  for (let i = 0; i < 56; i++) { mm.makeTranslation(-1.5 + i * 0.6, 0.12, 0); plank.setMatrixAt(i, mm); }
  a.group.add(plank);
  const isl = new THREE.Mesh(new THREE.CylinderGeometry(IR, IR + 1.5, 1.2, 48), new THREE.MeshStandardMaterial({ color: 0x6f7f9f, roughness: 0.45, metalness: 0.2, emissive: 0x18284a, emissiveIntensity: 0.6 }));
  isl.position.set(IS.x, -0.3, IS.z);
  isl.receiveShadow = true;
  a.group.add(isl);
  put(a, 'cross', IS.x, IS.z, { obstacle: 2.2, y: 0.3 });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0xcfe8ff).multiplyScalar(0.7), blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(34, 34, 1);
  halo.position.set(IS.x, 16, IS.z);
  a.group.add(halo);
  light(a, 0xcfe8ff, 16, 34, IS.x - 6, 5, IS.z + 3);
  a.points.cross = V(IS.x - 4, 0.3, 0);

  const kaoru = npc(a, 'kaoru', 35, 2.4, -Math.PI / 2, '薰');
  kaoru.root.position.y = 0.3;
  a.points.view = V(-8, shoreH(-8, -30), -30);
  const vr = live(a, createRing(1.6, 0xf4d58d));
  vr.position.copy(a.points.view).setY(a.points.view.y + 0.05);

  let rise = -1;
  a.onStep = (step, reached, fresh) => {
    if (reached('ascend')) rise = fresh && step.id === 'ascend' ? 0 : 10;
  };
  a.updaters.push((dt, t) => {
    halo.material.opacity = 0.75 + Math.sin(t * 1.3) * 0.2;
    if (rise >= 0) {
      rise += dt;
      kaoru.root.position.y = 0.3 + rise * rise * 0.6;
      kaoru.setOpacity(Math.max(0, 1 - rise / 3.5));
    }
  });
  a.spawns = [[-26.5, -0.8, Math.PI / 2], [-26.5, 0.9, Math.PI / 2]];
  return a;
}

let _glow;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}
