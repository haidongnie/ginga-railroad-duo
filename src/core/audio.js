// Fully procedural score: a slow pad, twinkling pentatonic chimes, train rhythm and small SFX.
const CHORDS = [
  [57, 64, 69, 76], // Am(add9-ish)
  [53, 60, 65, 72], // F
  [48, 55, 64, 71], // Cmaj7
  [55, 62, 67, 74], // G
];
const PENTA = [69, 72, 74, 76, 79, 81, 84, 86, 88, 91];
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('ginga-muted') === '1';
    this.trainOn = false;
  }

  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(3.5);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.verb.connect(wet).connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.bus.connect(this.verb);
    this.chord = 0;
    this.nextChord = ctx.currentTime + 0.2;
    this.nextChime = ctx.currentTime + 1;
    this.nextClack = ctx.currentTime + 1;
    this.timer = setInterval(() => this.schedule(), 200);
  }

  impulse(sec) {
    const ctx = this.ctx, len = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }

  schedule() {
    const ctx = this.ctx, t = ctx.currentTime;
    while (this.nextChord < t + 0.5) {
      this.pad(CHORDS[this.chord % CHORDS.length], this.nextChord, 9);
      this.chord++;
      this.nextChord += 8;
    }
    while (this.nextChime < t + 0.5) {
      const n = PENTA[(Math.random() * PENTA.length) | 0];
      this.bell(hz(n), this.nextChime, 0.05 + Math.random() * 0.05);
      this.nextChime += 0.6 + Math.random() * 2.4;
    }
    if (this.trainOn) {
      while (this.nextClack < t + 0.5) {
        this.clack(this.nextClack, 0.16);
        this.clack(this.nextClack + 0.17, 0.12);
        this.nextClack += 1.15;
      }
    } else this.nextClack = t + 0.3;
  }

  pad(notes, at, dur) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700, at);
    filter.frequency.linearRampToValueAtTime(1400, at + dur * 0.5);
    filter.frequency.linearRampToValueAtTime(600, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.045, at + 3);
    g.gain.linearRampToValueAtTime(0.0, at + dur);
    filter.connect(g).connect(this.bus);
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(n - 12);
        o.detune.value = det;
        o.connect(filter);
        o.start(at);
        o.stop(at + dur + 0.1);
      }
    }
  }

  bell(f, at, vol = 0.08, dur = 2.8) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    m.frequency.value = f * 3.5;
    mg.gain.setValueAtTime(f * 0.6, at);
    mg.gain.exponentialRampToValueAtTime(1, at + dur);
    m.connect(mg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.bus);
    o.start(at); m.start(at);
    o.stop(at + dur); m.stop(at + dur);
  }

  noise(at, dur, freq, q, vol) {
    const ctx = this.ctx;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(at);
  }

  clack(at, vol) {
    this.noise(at, 0.12, 180, 1.2, vol);
    this.noise(at, 0.05, 2400, 3, vol * 0.25);
  }

  sfx(name) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    switch (name) {
      case 'pickup': [79, 84, 88].forEach((n, i) => this.bell(hz(n), t + i * 0.07, 0.12, 1.6)); break;
      case 'ok': [72, 79].forEach((n, i) => this.bell(hz(n), t + i * 0.12, 0.1, 2)); break;
      case 'goal': [69, 76, 81, 88, 93].forEach((n, i) => this.bell(hz(n), t + i * 0.11, 0.12, 3)); break;
      case 'blip': this.bell(hz(91), t, 0.04, 0.6); break;
      case 'whistle': this.whistle(t); break;
      case 'fire': this.noise(t, 3.5, 90, 0.7, 0.5); this.noise(t + 0.2, 3, 400, 0.5, 0.15); break;
      case 'wave': this.bell(hz(84), t, 0.06, 1.2); break;
    }
  }

  whistle(at) {
    const ctx = this.ctx;
    for (const [f, d] of [[hz(74), 0], [hz(78), 0], [hz(81), 0]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      lfo.frequency.value = 5.5;
      lg.gain.value = 4;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, at + d);
      g.gain.exponentialRampToValueAtTime(0.05, at + d + 0.15);
      g.gain.setValueAtTime(0.05, at + d + 1.1);
      g.gain.exponentialRampToValueAtTime(0.0001, at + d + 1.8);
      o.connect(g).connect(this.bus);
      o.start(at + d); lfo.start(at + d);
      o.stop(at + d + 2); lfo.stop(at + d + 2);
    }
  }

  setTrain(on) { this.trainOn = on; }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('ginga-muted', this.muted ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.2);
    return this.muted;
  }
}
