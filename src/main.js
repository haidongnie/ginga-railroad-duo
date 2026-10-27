import * as THREE from 'three';
import { createRenderer, createEnvironment } from './core/renderer.js';
import { loadAssets } from './core/assets.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { createSky } from './world/sky.js';
import { Hud } from './ui/hud.js';
import { Game } from './game/game.js';

const canvas = document.getElementById('c');
const { renderer, scene, camera, composer } = createRenderer(canvas);
scene.environment = createEnvironment(renderer);
scene.background = new THREE.Color(0x02030a);
const sky = createSky();
scene.add(sky.group);

const input = new Input(canvas);
const audio = new Audio();
const hud = new Hud();
const game = new Game({ scene, camera, renderer, sky, input, audio, hud });

// Title screen: slow pan across the Milky Way while assets load.
const startBtn = document.getElementById('start');
const nameInput = document.getElementById('name');
const invited = /[#&]r=/.test(location.hash);
nameInput.value = localStorage.getItem('ginga-name') || '';
if (invited) document.getElementById('joinhint').hidden = false;

loadAssets((p) => {
  document.getElementById('loadfill').style.width = `${Math.round(p * 100)}%`;
  document.getElementById('loadtext').textContent = p < 1 ? `正在把 Meshy 生成的模型装上列车…… ${Math.round(p * 100)}%` : '列车已经准备好了。';
}).then(() => {
  startBtn.disabled = false;
  startBtn.textContent = invited ? '上车' : '启程';
});

let playing = false;
startBtn.addEventListener('click', async () => {
  const name = (nameInput.value.trim() || (invited ? '康帕内拉' : '乔凡尼')).slice(0, 10);
  localStorage.setItem('ginga-name', nameInput.value.trim());
  startBtn.disabled = true;
  startBtn.textContent = '正在连接列车……';
  audio.start();
  await game.connect(name);
  document.getElementById('title').hidden = true;
  hud.show();
  playing = true;
});
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !startBtn.disabled) startBtn.click(); });

document.getElementById('dialog').addEventListener('click', () => game.dialogClick());
document.getElementById('again').addEventListener('click', () => game.requestRestart());
const soundBtn = document.getElementById('btn-sound');
soundBtn.classList.toggle('muted', audio.muted);
soundBtn.addEventListener('click', () => soundBtn.classList.toggle('muted', audio.toggleMute()));

const timer = new THREE.Timer();
timer.connect(document);
renderer.setAnimationLoop((now) => {
  timer.update(now);
  if (!innerWidth || !innerHeight) return; // hidden / zero-size viewport: skip the frame
  if (renderer.domElement.width === 0) dispatchEvent(new Event('resize'));
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();
  if (playing) game.update(dt, t);
  else {
    camera.position.set(0, 1.5, 0);
    camera.lookAt(Math.sin(t * 0.03) * 10, 4 + Math.sin(t * 0.05), -10);
  }
  sky.update(t, camera);
  composer.render();
});

// Expose for debugging in the console (dev server only).
if (import.meta.env.DEV) window.ginga = { game, scene, camera, renderer, composer };
