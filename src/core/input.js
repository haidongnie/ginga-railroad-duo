import { isTouch } from './renderer.js';

// Unified keyboard / mouse / touch input. Movement is read as a vector; actions as one-shot presses.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.look = { dx: 0, dy: 0, zoom: 0 };
    this.stick = { x: 0, y: 0 };
    this.touchRun = false;
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // Mouse drag / touch drag on the canvas orbits the camera.
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      this.look.dx += dx; this.look.dy += dy;
    });
    const end = (e) => {
      if (drag && drag.id === e.pointerId && drag.moved < 6) this.pressed.add('Tap');
      drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => { this.look.zoom += Math.sign(e.deltaY); }, { passive: true });

    if (isTouch) this.setupTouch();
  }

  setupTouch() {
    document.getElementById('touch').hidden = false;
    const stick = document.getElementById('stick');
    const knob = stick.querySelector('i');
    let id = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      let x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
      let y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      this.stick.x = x; this.stick.y = y;
      knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); move(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const release = (e) => {
      if (e.pointerId !== id) return;
      id = null; this.stick.x = 0; this.stick.y = 0; knob.style.transform = '';
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);

    const tap = (elId, code) => document.getElementById(elId).addEventListener('pointerdown', (e) => {
      e.preventDefault(); this.pressed.add(code);
    });
    tap('t-act', 'KeyE');
    tap('t-wave', 'KeyQ');
    const run = document.getElementById('t-run');
    run.addEventListener('pointerdown', (e) => {
      e.preventDefault(); this.touchRun = !this.touchRun; run.classList.toggle('on', this.touchRun);
    });
  }

  // Camera-relative move vector in the XZ plane (x right, y forward), length <= 1.
  move() {
    if (!this.enabled) return { x: 0, y: 0, run: false };
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    x += this.stick.x; y -= this.stick.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y, run: k.has('ShiftLeft') || k.has('ShiftRight') || this.touchRun || Math.hypot(this.stick.x, this.stick.y) > 0.95 };
  }

  consume(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  takeLook() {
    const l = { ...this.look };
    this.look.dx = this.look.dy = this.look.zoom = 0;
    return l;
  }

  endFrame() {
    this.pressed.clear();
  }
}
