import * as THREE from 'three';
import { NOISE_GLSL, rng } from './noise.js';

// Heightfield ground with vertex colors. `height(x,z)` and `color(x,z,h,out)` define the look.
export function createGround({ size = 200, seg = 160, height, color, roughness = 0.95, center = [0, 0] }) {
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(center[0], 0, center[1]);
  const p = geo.attributes.position;
  const cols = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const h = height(x, z);
    p.setY(i, h);
    color(x, z, h, c);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0.0, envMapIntensity: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// Instanced grass blades bending in the wind. `glowTips` turns them into silver pampas that catch starlight.
export function createGrass({ count, area, height, seed = 1, bladeH = [0.35, 0.8], base = 0x0f2a33, tip = 0x5f8fa8, glowTips = 0, filter, wrap = false }) {
  const blade = new THREE.BufferGeometry();
  const verts = [-0.035, 0, 0, 0.035, 0, 0, -0.025, 0.45, 0, 0.025, 0.45, 0, 0, 1, 0];
  blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.attributes.position = blade.attributes.position;
  const offs = [], rots = [];
  const r = rng(seed);
  let tries = 0;
  while (offs.length / 4 < count && tries++ < count * 6) {
    const x = area[0] + r() * (area[2] - area[0]);
    const z = area[1] + r() * (area[3] - area[1]);
    if (filter && !filter(x, z)) continue;
    offs.push(x, height(x, z), z, bladeH[0] + r() * (bladeH[1] - bladeH[0]));
    rots.push(r() * Math.PI * 2, r());
  }
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(offs), 4));
  geo.setAttribute('aRot', new THREE.InstancedBufferAttribute(new Float32Array(rots), 2));
  geo.instanceCount = offs.length / 4;
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uBase: { value: new THREE.Color(base) },
      uTip: { value: new THREE.Color(tip) },
      uGlow: { value: glowTips },
      uScroll: { value: 0 },
      uWrap: { value: new THREE.Vector2(area[1], wrap ? area[3] - area[1] : 0) },
    }]),
    vertexShader: `${NOISE_GLSL}
      attribute vec4 aOff; attribute vec2 aRot; uniform float uTime; uniform float uScroll; uniform vec2 uWrap; varying float vH; varying float vR;
      #include <fog_pars_vertex>
      void main(){
        vec4 off = aOff;
        if (uWrap.y > 0.0) off.z = uWrap.x + mod(aOff.z - uWrap.x - uScroll, uWrap.y);
        vec3 p = position; p.y *= aOff.w; p.x *= 1.0 + aOff.w * 0.2;
        float c = cos(aRot.x), s = sin(aRot.x);
        p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
        float w = vnoise2(aOff.xz * 0.08 + vec2(uTime * 0.35, uTime * 0.12));
        float bend = (w - 0.35) * 0.9 + sin(uTime * 2.0 + aOff.x * 0.7 + aRot.y * 6.0) * 0.08;
        float k = position.y * position.y;
        p.x += bend * k * aOff.w; p.z += bend * 0.5 * k * aOff.w;
        p.y -= abs(bend) * k * 0.25 * aOff.w;
        vH = position.y; vR = aRot.y;
        vec4 mvPosition = modelViewMatrix * vec4(p + off.xyz, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform vec3 uBase; uniform vec3 uTip; uniform float uGlow; varying float vH; varying float vR;
      #include <fog_pars_fragment>
      void main(){
        vec3 col = mix(uBase, uTip, smoothstep(0.1, 1.0, vH)) * (0.75 + 0.5 * vR);
        col += uTip * uGlow * smoothstep(0.75, 1.0, vH) * (0.3 + 0.7 * vR) * 0.7;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.update = (t) => { mat.uniforms.uTime.value = t; };
  mesh.userData.scroll = (s) => { mat.uniforms.uScroll.value = s; };
  return mesh;
}

// The river of the galaxy: flowing luminous water strewn with sparkles.
export function createRiver({ width, length, y = 0, position = [0, 0], rotation = 0, flow = 1, color1 = 0x1a3cff, color2 = 0x7fe9ff }) {
  const geo = new THREE.PlaneGeometry(width, length, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: new THREE.Vector2(width, length) },
      uFlow: { value: flow },
      uC1: { value: new THREE.Color(color1) },
      uC2: { value: new THREE.Color(color2) },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vW;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${NOISE_GLSL}
      uniform float uTime; uniform vec2 uSize; uniform float uFlow; uniform vec3 uC1; uniform vec3 uC2;
      varying vec2 vUv; varying vec3 vW;
      void main(){
        vec2 p = vec2(vUv.x * uSize.x, vUv.y * uSize.y);
        float t = uTime * uFlow;
        float n = fbm2(p * 0.06 + vec2(0.0, t * 0.08));
        float n2 = fbm2(p * 0.18 - vec2(t * 0.03, t * 0.21));
        vec3 col = mix(uC1 * 0.25, uC2 * 0.6, smoothstep(0.35, 0.8, n));
        col += uC2 * pow(n2, 3.0) * 0.8;
        // Star sparkles drifting downstream.
        vec2 g = p * 0.9 + vec2(0.0, t * 1.2);
        vec2 id = floor(g); vec2 f = fract(g) - 0.5;
        float h = hash12(id);
        float star = step(0.86, h) * smoothstep(0.12, 0.0, length(f + (vec2(hash12(id + 3.1), hash12(id + 7.7)) - 0.5) * 0.6));
        star *= 0.5 + 0.5 * sin(uTime * (2.0 + h * 4.0) + h * 50.0);
        col += mix(vec3(1.0), uC2, 0.3) * star * 2.4;
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
        gl_FragColor = vec4(col, 0.92 * edge);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(position[0], y, position[1]);
  mesh.rotation.y = rotation;
  mesh.renderOrder = 1;
  mesh.userData.update = (t) => { mat.uniforms.uTime.value = t; };
  return mesh;
}

// Drifting motes of light (fireflies / star dust) inside a box.
export function createMotes({ count = 300, box, color = 0x9fe6ff, size = 6, seed = 7, rise = 0.2 }) {
  const r = rng(seed);
  const pos = new Float32Array(count * 3);
  const ph = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([box[0] + r() * (box[3] - box[0]), box[1] + r() * (box[4] - box[1]), box[2] + r() * (box[5] - box[2])], i * 3);
    ph[i] = r() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uSize: { value: size * Math.min(devicePixelRatio, 2) },
      uH: { value: box[4] - box[1] }, uY0: { value: box[1] }, uRise: { value: rise },
    },
    vertexShader: `attribute float phase; uniform float uTime; uniform float uSize; uniform float uH; uniform float uY0; uniform float uRise; varying float vA;
      void main(){
        vec3 p = position;
        p.y = uY0 + mod(position.y - uY0 + uTime * uRise, uH);
        p.x += sin(uTime * 0.5 + phase) * 0.6; p.z += cos(uTime * 0.4 + phase * 1.3) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = 0.5 + 0.5 * sin(uTime * 2.0 + phase * 3.0);
        gl_PointSize = uSize * (0.6 + vA * 0.6) * (20.0 / -mv.z);
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor * a * (0.4 + vA), 1.0); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.update = (t) => { mat.uniforms.uTime.value = t; };
  return pts;
}

// Glowing ring on the ground used for pressure plates and markers.
export function createRing(radius = 1, color = 0x8fe3ff) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uOn: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uOn; varying vec2 vUv;
      void main(){
        float d = length(vUv - 0.5) * 2.0;
        float ring = smoothstep(0.08, 0.0, abs(d - 0.85)) + smoothstep(0.05, 0.0, abs(d - 0.55 - 0.1 * sin(uTime * 2.0))) * 0.5;
        float fill = smoothstep(1.0, 0.0, d) * (0.15 + uOn * 0.5);
        float pulse = 0.7 + 0.3 * sin(uTime * 3.0);
        gl_FragColor = vec4(uColor * (ring * pulse * (1.0 + uOn * 1.5) + fill), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.4, radius * 2.4), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.userData.update = (t) => { mat.uniforms.uTime.value = t; };
  mesh.userData.setOn = (v) => { mat.uniforms.uOn.value = v; };
  return mesh;
}

// Vertical beam of light (lighthouse, scorpion fire, quest markers).
export function createBeam({ radius = 0.6, height = 30, color = 0xffd27a, intensity = 1 }) {
  const geo = new THREE.CylinderGeometry(radius * 0.4, radius, height, 24, 1, true);
  geo.translate(0, height / 2, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uI: { value: intensity } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `${NOISE_GLSL}
      uniform float uTime; uniform vec3 uColor; uniform float uI; varying vec2 vUv;
      void main(){
        float n = fbm2(vec2(vUv.x * 8.0, vUv.y * 3.0 - uTime * 0.8));
        float a = (1.0 - vUv.y) * (0.35 + 0.65 * n) * uI;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.update = (t) => { mat.uniforms.uTime.value = t; };
  mesh.userData.material = mat;
  return mesh;
}
