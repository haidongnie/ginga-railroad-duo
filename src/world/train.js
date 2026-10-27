import * as THREE from 'three';
import { spawn, size } from '../core/assets.js';

// Meshy's locomotive faces -Z after normalisation; flip so +Z is the direction of travel.
const FORWARD_FLIP = { locomotive: true, carriage: false };
const GAP = 0.7;

export function createTrack(curve, { glow = 0x7fd4ff, sleepers = true } = {}) {
  const group = new THREE.Group();
  const L = curve.getLength();
  const n = Math.max(2, Math.floor(L / 0.9));
  const up = new THREE.Vector3(0, 1, 0);
  const left = [], right = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3(), side = new THREE.Vector3();
  const sleeperGeo = new THREE.BoxGeometry(2.3, 0.12, 0.28);
  const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.9 });
  const inst = new THREE.InstancedMesh(sleeperGeo, sleeperMat, n + 1);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t);
    side.crossVectors(t, up).normalize();
    left.push(p.clone().addScaledVector(side, -0.72).add(new THREE.Vector3(0, 0.14, 0)));
    right.push(p.clone().addScaledVector(side, 0.72).add(new THREE.Vector3(0, 0.14, 0)));
    q.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), t, up));
    m.compose(p, q, new THREE.Vector3(1, 1, 1));
    inst.setMatrixAt(i, m);
  }
  inst.receiveShadow = true;
  if (sleepers) group.add(inst);
  const railMat = new THREE.MeshStandardMaterial({ color: 0xaab8d0, metalness: 0.9, roughness: 0.25, emissive: glow, emissiveIntensity: 0.9 });
  for (const pts of [left, right]) {
    const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, 0.055, 6, false), railMat);
    group.add(rail);
  }
  return group;
}

export class Train {
  constructor() {
    this.group = new THREE.Group();
    this.cars = ['locomotive', 'carriage', 'carriage'].map((id) => {
      const obj = spawn(id);
      const holder = new THREE.Group();
      if (FORWARD_FLIP[id]) obj.rotation.y = Math.PI;
      holder.add(obj);
      this.group.add(holder);
      return { id, holder, len: size(id).z };
    });
    this.length = this.cars.reduce((a, c) => a + c.len + GAP, -GAP);

    // Headlamp.
    const loco = this.cars[0];
    this.lamp = new THREE.PointLight(0xffd59a, 40, 30, 1.6);
    this.lamp.position.set(0, 2.2, loco.len / 2 + 0.4);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe2a8).multiplyScalar(6) }));
    bulb.position.copy(this.lamp.position);
    loco.holder.add(this.lamp, bulb);
    // Warm light spilling from the passenger windows (one light keeps the shader cost down).
    const spill = new THREE.PointLight(0xffc77a, 16, 14, 1.8);
    spill.position.set(0, 2.0, 0);
    this.cars[1].holder.add(spill);

    this.dust = createDust();
    this.group.add(this.dust.points);
    this.curve = null;
    this.s = 0;
    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  setCurve(curve) {
    this.curve = curve;
    this.L = curve.getLength();
  }

  // s = arc length of the locomotive's nose along the curve.
  place(s) {
    this.s = s;
    let back = 0;
    for (const car of this.cars) {
      const d = s - back - car.len / 2;
      const u = THREE.MathUtils.clamp(d / this.L, 0, 1);
      this.curve.getPointAt(u, this._p);
      this.curve.getTangentAt(u, this._t);
      car.holder.position.copy(this._p);
      car.holder.lookAt(this._p.x + this._t.x, this._p.y + this._t.y, this._p.z + this._t.z);
      back += car.len + GAP;
    }
  }

  // Door on the side of a carriage, in world space (side = +1 right / -1 left).
  door(carIndex = 1, side = 1) {
    const car = this.cars[carIndex].holder;
    car.updateMatrixWorld(true);
    return new THREE.Vector3(side * 2.3, 0, 0).applyMatrix4(car.matrixWorld);
  }

  update(dt, t, moving) {
    const loco = this.cars[0].holder;
    loco.updateMatrixWorld(true);
    this.dust.update(dt, t, loco, moving);
  }
}

// Star-dust exhaust drifting out of the funnel.
function createDust() {
  const N = 260;
  const pos = new Float32Array(N * 3);
  const life = new Float32Array(N);
  const vel = [];
  for (let i = 0; i < N; i++) { life[i] = 1; vel.push(new THREE.Vector3()); pos[i * 3 + 1] = -999; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('life', new THREE.BufferAttribute(life, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPR: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: `attribute float life; uniform float uPR; varying float vL;
      void main(){ vL = life; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPR * (14.0 + 40.0 * life) * (10.0 / -mv.z); }`,
    fragmentShader: `varying float vL;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * (1.0 - vL) * 0.8;
        vec3 c = mix(vec3(1.0, 0.9, 0.7), vec3(0.5, 0.75, 1.0), vL); gl_FragColor = vec4(c * a, 1.0); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const funnel = new THREE.Vector3(0, 4.3, 2.4);
  const w = new THREE.Vector3();
  let next = 0;
  return {
    points,
    update(dt, t, loco, moving) {
      const rate = moving ? 70 : 18;
      next += dt * rate;
      while (next > 1) {
        next -= 1;
        let i = -1;
        for (let k = 0; k < N; k++) if (life[k] >= 1) { i = k; break; }
        if (i < 0) break;
        w.copy(funnel).applyMatrix4(loco.matrixWorld);
        pos.set([w.x, w.y, w.z], i * 3);
        life[i] = 0;
        vel[i].set((Math.random() - 0.5) * 0.8, 1.2 + Math.random(), (Math.random() - 0.5) * 0.8);
      }
      for (let i = 0; i < N; i++) {
        if (life[i] >= 1) continue;
        life[i] = Math.min(1, life[i] + dt * 0.45);
        pos[i * 3] += vel[i].x * dt;
        pos[i * 3 + 1] += vel[i].y * dt;
        pos[i * 3 + 2] += vel[i].z * dt;
        if (life[i] >= 1) pos[i * 3 + 1] = -999;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.life.needsUpdate = true;
    },
  };
}
