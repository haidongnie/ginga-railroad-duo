import * as THREE from 'three';
import { NOISE_GLSL } from './noise.js';

// Galactic plane: the Milky Way band is the great circle perpendicular to this axis.
const GAL_AXIS = new THREE.Vector3(0.42, 0.62, -0.66).normalize();

export function createSky() {
  const group = new THREE.Group();
  group.name = 'sky';

  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uAxis: { value: GAL_AXIS },
      uDawn: { value: 0 },
      uCoal: { value: new THREE.Vector4(0, 0, -1, 0) }, // xyz dir, w strength
    },
    vertexShader: `varying vec3 vDir;
      void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `${NOISE_GLSL}
      uniform float uTime; uniform vec3 uAxis; uniform float uDawn; uniform vec4 uCoal;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 zenith = vec3(0.006, 0.010, 0.040);
        vec3 horizon = vec3(0.045, 0.040, 0.120);
        vec3 col = mix(horizon, zenith, smoothstep(-0.05, 0.65, y));
        col = mix(col, vec3(0.008, 0.01, 0.03), smoothstep(0.0, -0.4, y));
        // Milky Way band with dust lanes.
        float g = dot(d, uAxis);
        float band = exp(-pow(g / 0.20, 2.0));
        float core = exp(-pow(g / 0.07, 2.0));
        float n = fbm(d * 3.2 + vec3(0.0, 0.0, uTime * 0.003));
        float n2 = fbm(d * 9.0 + 7.3);
        float dust = smoothstep(0.45, 0.75, fbm(d * 6.0 + 2.1)) * core;
        vec3 milk = mix(vec3(0.22, 0.30, 0.75), vec3(0.75, 0.55, 0.95), n2);
        milk = mix(milk, vec3(1.0, 0.86, 0.70), core * 0.6);
        col += milk * band * (0.25 + 0.9 * n) * (1.0 - dust * 0.85) * 0.9;
        col += vec3(0.25, 0.45, 0.9) * pow(band, 3.0) * n2 * 0.35;
        // Faint nebula wisps across the whole sky.
        col += vec3(0.20, 0.10, 0.35) * smoothstep(0.55, 0.9, fbm(d * 2.0 + 11.0)) * 0.25;
        // Coalsack: a soft hole of nothing.
        float coal = smoothstep(0.985, 0.996, dot(d, normalize(uCoal.xyz)));
        col = mix(col, vec3(0.0), coal * uCoal.w);
        // Dawn: warm horizon glow, sky brightens.
        vec3 dawnCol = mix(vec3(0.95, 0.55, 0.35), vec3(0.35, 0.45, 0.75), smoothstep(-0.05, 0.5, y));
        col = mix(col, dawnCol * (0.6 + 0.4 * smoothstep(0.3, -0.05, y)), uDawn * smoothstep(-0.25, 0.1, y + 0.2) * 0.85);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 32), domeMat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  const stars = makeStars(9000, 0.35);
  const milky = makeStars(16000, 1.0);
  group.add(stars, milky);

  return {
    group,
    dome: domeMat,
    setDawn(v) {
      domeMat.uniforms.uDawn.value = v;
      stars.material.uniforms.uFade.value = 1 - v * 0.85;
      milky.material.uniforms.uFade.value = 1 - v * 0.9;
    },
    setCoalsack(dir, strength) {
      domeMat.uniforms.uCoal.value.set(dir.x, dir.y, dir.z, strength);
    },
    update(t, camera) {
      group.position.copy(camera.position);
      domeMat.uniforms.uTime.value = t;
      stars.material.uniforms.uTime.value = t;
      milky.material.uniforms.uTime.value = t;
      group.rotation.y = t * 0.002;
    },
  };
}

// bandBias 0 = uniform sky, 1 = concentrated along the galactic plane.
function makeStars(count, bandBias) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const v = new THREE.Vector3();
  const u = new THREE.Vector3(1, 0, 0).cross(GAL_AXIS).normalize();
  const w = GAL_AXIS.clone().cross(u).normalize();
  const palette = [new THREE.Color(0xbfd8ff), new THREE.Color(0xffffff), new THREE.Color(0xfff1c9), new THREE.Color(0xffc9a0), new THREE.Color(0x9fc2ff)];
  for (let i = 0; i < count; i++) {
    if (Math.random() < bandBias) {
      const a = Math.random() * Math.PI * 2;
      const spread = gauss() * 0.12;
      v.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a)).addScaledVector(GAL_AXIS, spread).normalize();
    } else {
      v.set(gauss(), gauss(), gauss()).normalize();
    }
    if (v.y < -0.25) v.y = -v.y * 0.5;
    v.multiplyScalar(800);
    pos.set([v.x, v.y, v.z], i * 3);
    const c = palette[(Math.random() * palette.length) | 0];
    const b = bandBias > 0.5 ? 0.35 + Math.random() * 0.5 : 0.6 + Math.random() * 0.8;
    col.set([c.r * b, c.g * b, c.b * b], i * 3);
    const big = Math.random() < (bandBias > 0.5 ? 0.01 : 0.04);
    size[i] = big ? 3 + Math.random() * 3.5 : 0.8 + Math.random() * (bandBias > 0.5 ? 1.2 : 1.8);
    phase[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPR: { value: Math.min(devicePixelRatio, 2) }, uFade: { value: 1 } },
    vertexShader: `attribute float size; attribute float phase; attribute vec3 color;
      uniform float uTime; uniform float uPR; varying vec3 vColor; varying float vTw;
      void main(){
        vColor = color;
        vTw = 0.65 + 0.35 * sin(uTime * (1.5 + fract(phase) * 3.0) + phase);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
        gl_PointSize = size * uPR * (0.8 + 0.4 * vTw);
      }`,
    fragmentShader: `uniform float uFade; varying vec3 vColor; varying float vTw;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        float core = smoothstep(0.18, 0.0, d);
        gl_FragColor = vec4(vColor * (a * 0.8 + core * 1.6) * vTw * uFade, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -9;
  return pts;
}

function gauss() {
  return Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(Math.PI * 2 * Math.random());
}
