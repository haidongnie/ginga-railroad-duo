import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const isTouch = matchMedia('(pointer: coarse)').matches;

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const dpr = Math.min(devicePixelRatio, isTouch ? 1.5 : 1.75);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);

  // MSAA render target keeps edges clean through the bloom chain.
  const target = new THREE.WebGLRenderTarget(innerWidth * dpr, innerHeight * dpr, {
    type: THREE.HalfFloatType,
    samples: isTouch ? 0 : 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.85, 0.55, 0.78);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.fov = camera.aspect < 0.8 ? 72 : 55; // portrait phones need a wider view
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
    bloom.resolution.set(innerWidth / 2, innerHeight / 2);
  }
  addEventListener('resize', resize);
  resize();

  return { renderer, scene, camera, composer, bloom };
}

// Builds a soft night-sky environment map so PBR materials pick up cool reflections.
export function createEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir;
      void main(){
        float y = vDir.y;
        vec3 top = vec3(0.10, 0.14, 0.34);
        vec3 hor = vec3(0.22, 0.20, 0.42);
        vec3 bot = vec3(0.02, 0.03, 0.07);
        vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.6)) : mix(hor, bot, pow(-y, 0.5));
        float band = exp(-pow(dot(vDir, normalize(vec3(0.35, 0.55, -0.75))) / 0.25, 2.0));
        c += vec3(0.30, 0.40, 0.75) * band * 0.9;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(geo, mat));
  const rt = pmrem.fromScene(envScene, 0.02);
  geo.dispose();
  mat.dispose();
  pmrem.dispose();
  return rt.texture;
}
