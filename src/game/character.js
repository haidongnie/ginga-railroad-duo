import * as THREE from 'three';
import { spawn, clips, CLIP } from '../core/assets.js';

// A Meshy-rigged character with cross-faded animation states and an optional floating name tag.
export class Character {
  constructor(id, { label, color = '#f4d58d' } = {}) {
    this.id = id;
    this.root = new THREE.Group();
    this.model = spawn(id);
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [key, name] of Object.entries(CLIP)) {
      const clip = clips(id).find((c) => c.name === name);
      if (clip) this.actions[key] = this.mixer.clipAction(clip);
    }
    for (const k of ['wave', 'pickup', 'bow']) {
      const a = this.actions[k];
      if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    }
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.current && this.onceReturn) this.play(this.onceReturn, 0.35);
    });
    this.current = null;
    this.state = null;
    this.opacity = 1;
    if (label) this.setLabel(label, color);
    this.play('idle', 0);
  }

  play(state, fade = 0.25) {
    if (this.state === state && state !== 'wave' && state !== 'pickup') return;
    const next = this.actions[state] || this.actions.idle;
    if (!next) return;
    this.onceReturn = null;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current && this.current !== next) this.current.fadeOut(fade);
    this.current = next;
    this.state = state;
  }

  playOnce(state, back = 'idle') {
    if (!this.actions[state]) return;
    this.play(state, 0.2);
    this.onceReturn = back;
  }

  get busy() {
    return !!this.onceReturn;
  }

  setSpeed(scale) {
    if (this.current) this.current.timeScale = scale;
  }

  setLabel(text, color) {
    if (this.label) { this.root.remove(this.label); this.label.material.map.dispose(); }
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = '600 30px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 8;
    g.fillStyle = color;
    g.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Constant on-screen size so tags stay readable without filling the view up close.
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, sizeAttenuation: false }));
    s.scale.set(0.15, 0.0375, 1);
    s.position.y = (this.model.userData.size?.y || 1.5) + 0.35;
    s.renderOrder = 5;
    this.label = s;
    this.root.add(s);
  }

  // Fade the whole character (used for the farewell at the Coalsack).
  setOpacity(v) {
    if (v === this.opacity) return;
    this.opacity = v;
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.userData.ownMat) { o.material = o.material.clone(); o.userData.ownMat = true; }
      o.material.transparent = v < 1;
      o.material.opacity = v;
      o.material.depthWrite = v > 0.5;
      o.castShadow = v > 0.5;
      if (!o.userData.baseEmissive) o.userData.baseEmissive = o.material.emissive.clone();
      o.material.emissive.setRGB(0.4, 0.6, 1.0).multiplyScalar((1 - v) * 1.5);
    });
    if (this.label) this.label.material.opacity = v;
    this.root.visible = v > 0.01;
  }

  update(dt) {
    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
