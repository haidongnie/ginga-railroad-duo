import * as THREE from 'three';
import * as net from './net.js';
import { CHAPTERS, DIALOGS, SPEAKERS, ROLES, otherRole, ENDING_TEXT } from './story.js';
import { buildArea } from '../world/areas.js';
import { Character } from './character.js';

const WALK = 1.75, RUN = 4.2, RADIUS = 0.28, SEND_DT = 1 / 12;
const V = () => new THREE.Vector3();
const angleLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const uniq = (arr) => [...new Set(arr)];
const DEFAULT_G = { run: 0, ch: 0, st: 0, fl: {} };
const tag = (name, role) => (name === ROLES[role].name ? ROLES[role].name : `${name} · ${ROLES[role].name}`);

export class Game {
  constructor({ scene, camera, renderer, sky, input, audio, hud }) {
    Object.assign(this, { scene, camera, renderer, sky, input, audio, hud });
    this.remotes = new Map();
    this.area = null;
    this.areaKey = null;
    this.stepKey = null;
    this.loading = false;
    this.cam = { yaw: Math.PI, pitch: 0.32, dist: 5 };
    this.me = { pos: V(), yaw: 0, anim: 'idle', sit: null, char: null, role: null, sendT: 0, ev: 0 };
    this.ai = null;
    this.dlgKey = '';
    this.spirit = null;
    this.hostKey = null;
    this.stepT = 0; // time spent in the current step, kept by every client
    this._v = V();
  }

  // ------------------------------------------------------------------ setup
  async connect(name) {
    const invited = /[#&]r=/.test(location.hash);
    const online = await net.connect({ g: JSON.stringify(DEFAULT_G), dlg: 'null' });
    this.online = online;
    net.register('dlg', (d) => this.hostDialog(d));
    net.register('act', (d) => this.hostAct(d));
    net.register('restart', () => this.hostRestart());
    net.register('toast', (d) => { if (!d.to || d.to === net.myPlayer().id) this.hud.toast(d.msg); });

    const me = net.myPlayer();
    me.setState('name', name, true);
    net.onPlayerJoin((p) => this.onJoin(p));

    const taken = net.players().filter((p) => p.id !== me.id).map((p) => p.getState('role')).filter(Boolean);
    let role = me.getState('role');
    if (!role || taken.includes(role)) {
      role = taken.includes('giovanni') ? 'campanella' : taken.includes('campanella') ? 'giovanni' : net.isHost() ? 'giovanni' : 'campanella';
    }
    me.setState('role', role, true);
    this.me.role = role;
    this.me.name = name;
    this.me.char = new Character(ROLES[role].model); // your own tag is in the HUD
    this.scene.add(this.me.char.root);

    // Dev only: ?ch=N lets the host start at a later chapter.
    const jump = new URLSearchParams(location.search).get('ch');
    if (import.meta.env.DEV && net.isHost() && jump !== null && !this.remotes.size) {
      this.setG({ ...DEFAULT_G, ch: THREE.MathUtils.clamp(+jump, 0, CHAPTERS.length - 1) });
    }
    if (!net.getJSON('g')) this.setG({ ...DEFAULT_G });

    this.hud.setInvite(location.href, ROLES[role].name, ROLES[otherRole(role)].name, !online);
    if (!online) this.hud.toast('联机服务暂时无法连接，进入单人模式');
    else if (!invited) setTimeout(() => { if (!this.remotes.size) this.hud.openInvite(); }, 2500);
  }

  onJoin(p) {
    if (p.id === net.myPlayer().id) return;
    const entry = { p, char: null, target: V(), yaw: 0, anim: '', ev: '', seen: false };
    this.remotes.set(p.id, entry);
    setTimeout(() => this.hud.toast(`${p.getState('name') || '同伴'} 登上了列车`), 800);
    p.onQuit(() => {
      entry.char?.dispose();
      this.remotes.delete(p.id);
      this.hud.toast(`${p.getState('name') || '同伴'} 下车了`);
    });
  }

  // ------------------------------------------------------------------ shared state
  g() { return net.getJSON('g') || DEFAULT_G; }
  setG(g) { net.setJSON('g', g); }
  chapter(g = this.g()) { return CHAPTERS[g.ch]; }
  step(g = this.g()) { return CHAPTERS[g.ch]?.steps[g.st]; }

  // Everyone in the party (humans + AI companion), positions in the current area.
  party() {
    const list = [{ id: net.myPlayer().id, role: this.me.role, pos: this.me.pos, human: true }];
    for (const r of this.remotes.values()) if (r.seen) list.push({ id: r.p.id, role: r.p.getState('role'), pos: r.target, human: true });
    if (this.ai) list.push({ role: this.ai.role, pos: this.ai.pos, human: false });
    return list;
  }

  occupied(step) {
    const res = {};
    if (!step?.plates || !this.area) return res;
    const party = this.party();
    for (const id of step.plates) {
      const pt = this.area.points[id];
      if (pt) res[id] = party.some((m) => flat(m.pos, pt) < 1.3);
    }
    return res;
  }

  // ------------------------------------------------------------------ host director
  hostTick(dt) {
    if (!net.isHost() || !this.area || this.loading) return;
    const g = this.g();
    const step = this.step(g);
    if (!step) return;
    const key = `${g.run}:${g.ch}:${g.st}`;
    if (key !== this.hostKey) {
      this.hostKey = key;
      // A new host (migration / reload) keeps a dialog that is already running for this step.
      if (step.type === 'dialog' && net.getJSON('dlg')?.id !== step.id) net.setJSON('dlg', { id: step.id, i: 0 });
      // A dialog never outlives its own step.
      if (step.type !== 'dialog' && net.getJSON('dlg')) net.setJSON('dlg', null);
    }
    const areaKey = `${g.run}:${g.ch}`;
    if (this.areaKey !== areaKey) return;
    for (const r of this.remotes.values()) if (r.p.getState('ld') !== areaKey) return;
    const fl = g.fl || {};
    const party = this.party();
    switch (step.type) {
      case 'goal': {
        const pt = this.area.points[step.point];
        if (pt && party.every((m) => flat(m.pos, pt) < step.r)) this.hostAdvance();
        break;
      }
      case 'collect':
      case 'ordered':
        if ((fl[step.group] || []).length >= step.need) this.hostAdvance();
        break;
      case 'talk':
        if (fl.talk === step.target) this.hostAdvance();
        break;
      case 'each': {
        const humans = party.filter((m) => m.human).map((m) => m.id);
        if (humans.every((id) => (fl.each || []).includes(id))) this.hostAdvance();
        break;
      }
      case 'plates': {
        const [a, b] = step.plates.map((id) => this.area.points[id]);
        const ok = party.some((m) => flat(m.pos, a) < 1.3 && party.some((n) => n !== m && flat(n.pos, b) < 1.3));
        if (ok) this.hostAdvance();
        break;
      }
      case 'event':
        if (this.stepT >= step.dur) this.hostAdvance();
        break;
    }
  }

  hostAdvance() {
    const g = this.g();
    const steps = CHAPTERS[g.ch].steps;
    if (g.st + 1 < steps.length) this.setG({ ...g, st: g.st + 1 });
    else if (g.ch + 1 < CHAPTERS.length) this.setG({ run: g.run, ch: g.ch + 1, st: 0, fl: {} });
  }

  hostDialog({ id, i }) {
    if (!net.isHost()) return;
    const d = net.getJSON('dlg');
    if (!d || d.id !== id || d.i !== i) return; // stale or duplicate request
    if (i + 1 < DIALOGS[id].length) net.setJSON('dlg', { id, i: i + 1 });
    else {
      net.setJSON('dlg', null);
      const step = this.step();
      if (step?.type === 'dialog' && step.id === id) this.hostAdvance();
    }
  }

  hostAct({ id, from }) {
    if (!net.isHost() || !this.area) return;
    const g = this.g();
    const step = this.step(g);
    const it = this.area.items.find((x) => x.id === id);
    if (!step || !it) return;
    const fl = { ...(g.fl || {}) };
    if ((step.type === 'collect') && it.group === step.group) {
      fl[it.group] = uniq([...(fl[it.group] || []), id]);
    } else if (step.type === 'ordered' && it.group === step.group) {
      const lit = fl[it.group] || [];
      if (lit.includes(id)) return;
      if (it.order !== lit.length) return this.toastTo(from, '顺序好像不对……先点亮正在闪烁的那颗星');
      fl[it.group] = [...lit, id];
    } else if (step.type === 'talk' && id === step.target) {
      fl.talk = id;
    } else if (step.type === 'each' && id === step.target) {
      fl.each = uniq([...(fl.each || []), from]);
    } else return;
    this.setG({ ...g, fl });
  }

  hostRestart() {
    if (!net.isHost()) return;
    const g = this.g();
    net.setJSON('dlg', null);
    this.setG({ run: g.run + 1, ch: 0, st: 0, fl: {} });
  }

  toastTo(id, msg) {
    if (!id || id === net.myPlayer().id) this.hud.toast(msg);
    else net.broadcast('toast', { to: id, msg });
  }

  // ------------------------------------------------------------------ client: areas & steps
  async loadArea(g) {
    this.loading = true;
    const key = `${g.run}:${g.ch}`;
    this.hud.hideDialog();
    this.hud.prompt(null);
    this.hud.hideEnding();
    const ch = CHAPTERS[g.ch];
    const white = ch.area === 'dawn';
    if (this.area) await this.hud.fade(true, white);
    this.area?.dispose();
    this.area = buildArea(ch.area);
    this.area.name = ch.area;
    this.scene.add(this.area.group);
    this.scene.fog = this.area.fog;
    this.scene.environmentIntensity = this.area.envIntensity;
    this.sky.setDawn(this.area.dawn);
    if (this.area.coalsack) this.sky.setCoalsack(this.area.coalsack, 1);
    else this.sky.setCoalsack(this._v.set(0, 0, -1), 0);
    this.audio.setTrain(this.area.trainSound);

    const idx = this.me.role === 'giovanni' ? 0 : 1;
    const [x, z, yaw] = this.area.spawns[idx];
    this.me.pos.set(x, this.area.height(x, z), z);
    this.me.yaw = yaw;
    this.me.sit = null;
    this.unstick(this.me.pos);
    this.cam.yaw = yaw + Math.PI;
    this.cam.pitch = 0.3;
    this.cam.dist = Math.min(5, this.area.camMax);
    this.camera.position.set(x - Math.sin(yaw) * this.cam.dist, this.me.pos.y + 2.5, z - Math.cos(yaw) * this.cam.dist);
    if (this.ai) this.placeAI();
    this.spirit = null;
    for (const c of this.allChars()) c.setOpacity(1);

    this.areaKey = key;
    this.stepKey = null;
    const p = net.myPlayer();
    p.setState('p', [this.me.pos.x, this.me.pos.y, this.me.pos.z, this.me.yaw], true);
    p.setState('seat', '', true);
    p.setState('ld', key, true);
    this.renderer.compile(this.scene, this.camera);
    this.hud.setChapter(ch.label, ch.title);
    this.hud.card(ch.label, ch.title);
    await this.hud.fade(false);
    this.loading = false;
  }

  onStep(g, fresh) {
    const ch = CHAPTERS[g.ch];
    const step = ch.steps[g.st];
    if (!step) return;
    const reached = (k) => {
      const j = ch.steps.findIndex((s) => s.id === k || s.group === k);
      return j >= 0 && j <= g.st;
    };
    this.reached = reached;
    this.area.onStep(step, reached, fresh);
    if (fresh && g.st > 0) this.audio.sfx('ok');
    if (step.id === 'trainArrive' && fresh) this.audio.sfx('whistle');
    if (step.id === 'fire' && fresh) this.audio.sfx('fire');
    if (step.id === 'lighthouseOn' && fresh) this.audio.sfx('goal');
    if ((step.type === 'goal' && step.point === 'door' && fresh)) this.audio.sfx('whistle');
    if (step.id === 'farewell') this.spirit = { t: fresh ? 0 : 99 };
    if (this.area.name === 'dawn') this.spirit = { t: 99, ghost: true };
    if (step.type === 'end') this.hud.ending(ENDING_TEXT);
    else this.hud.hideEnding();
  }

  allChars() {
    const out = [];
    if (this.me.char) out.push(this.me.char);
    if (this.ai) out.push(this.ai.char);
    for (const r of this.remotes.values()) if (r.char) out.push(r.char);
    return out;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, t) {
    if (!this.me.char) return; // not connected yet
    const g = this.g();
    const key = `${g.run}:${g.ch}`;
    if (key !== this.areaKey && !this.loading) this.loadArea(g);
    if (!this.area) return;

    if (!this.loading) {
      const sk = `${key}:${g.st}`;
      if (sk !== this.stepKey) {
        const fresh = !!this.stepKey && this.stepKey.startsWith(key + ':');
        this.stepKey = sk;
        this.stepT = 0;
        this.onStep(g, fresh);
      }
      this.stepT += dt;
      this.syncDialog();
    }

    this.updateAI(dt, t, g);
    this.updateLocal(dt, t, g);
    this.updateRemotes(dt);
    this.updateSpirit(dt);
    this.hostTick(dt);
    // While the next chapter's area is still loading, the old area must not see the new step.
    const step = this.areaKey === key ? this.step(g) : null;
    this.area.update(dt, t, { fl: step ? g.fl || {} : {}, step, occupied: this.occupied(step) });
    this.updateCamera(dt);
    this.updateHud(g, step);
    this.input.endFrame();
  }

  syncDialog() {
    const d = net.getJSON('dlg');
    const key = d ? `${d.id}:${d.i}` : '';
    if (key !== this.dlgKey) {
      this.dlgKey = key;
      this.dlgSentAt = 0;
      if (d && DIALOGS[d.id]?.[d.i]) {
        const [sp, text, alt] = DIALOGS[d.id][d.i];
        this.hud.dialog(SPEAKERS[sp], alt && this.me.role === 'campanella' ? alt : text, sp === 'n');
        this.audio.sfx('blip');
      } else this.hud.hideDialog();
    }
    if (!d) return;
    const i = this.input;
    if (i.consume('Space') || i.consume('Enter') || i.consume('KeyE') || i.consume('Tap') || this.dlgClicked) {
      this.dlgClicked = false;
      if (this.hud.finishTyping()) return;
      const now = performance.now();
      if (now - (this.dlgSentAt || 0) > 350) {
        this.dlgSentAt = now;
        net.callHost('dlg', { id: d.id, i: d.i });
      }
    }
  }

  // A spot a character may stand on: walkable and clear of every obstacle.
  isFree(x, z) {
    const a = this.area;
    return a.walkable(x, z) && a.obstacles.every((o) => (x - o.x) ** 2 + (z - o.z) ** 2 > (o.r + RADIUS) ** 2);
  }

  // Moves `pos` to the nearest free spot if it is inside an obstacle or off the walkable area.
  unstick(pos) {
    if (this.isFree(pos.x, pos.z)) return;
    for (let r = 0.15; r <= 6; r += 0.15) {
      for (let k = 0; k < 24; k++) {
        const ang = (k / 24) * Math.PI * 2;
        const x = pos.x + Math.cos(ang) * r, z = pos.z + Math.sin(ang) * r;
        if (this.isFree(x, z)) { pos.x = x; pos.z = z; pos.y = this.area.height(x, z); return; }
      }
    }
  }

  moveWithCollision(pos, dx, dz) {
    const a = this.area;
    // An obstacle you already overlap only blocks moves that go deeper into it,
    // so nothing (a seat, a teleport, a spawn) can trap a character inside one.
    const ok = (x, z) => a.walkable(x, z) && a.obstacles.every((o) => {
      const d2 = (x - o.x) ** 2 + (z - o.z) ** 2;
      return d2 > (o.r + RADIUS) ** 2 || d2 > (pos.x - o.x) ** 2 + (pos.z - o.z) ** 2;
    });
    if (ok(pos.x + dx, pos.z + dz)) { pos.x += dx; pos.z += dz; return true; }
    // Slide around the obstacle that blocks the move: drop the part of the move that points into it.
    // (The tangent step always increases the distance to that obstacle, so it can't push us deeper.)
    const nx0 = pos.x + dx, nz0 = pos.z + dz;
    const o = a.obstacles.find((o) => {
      const d2 = (nx0 - o.x) ** 2 + (nz0 - o.z) ** 2;
      return d2 <= (o.r + RADIUS) ** 2 && d2 <= (pos.x - o.x) ** 2 + (pos.z - o.z) ** 2;
    });
    if (o) {
      let nx = pos.x - o.x, nz = pos.z - o.z;
      const l = Math.hypot(nx, nz);
      if (l > 1e-6) {
        nx /= l; nz /= l;
        const k = dx * nx + dz * nz;
        if (k < 0) {
          const sx = dx - k * nx, sz = dz - k * nz;
          if (Math.hypot(sx, sz) > 1e-6 && ok(pos.x + sx, pos.z + sz)) { pos.x += sx; pos.z += sz; return true; }
        }
      }
    }
    // Axis fallback for walls and corners; a zero-length axis move is not progress.
    if (Math.abs(dx) > 1e-6 && ok(pos.x + dx, pos.z)) { pos.x += dx; return true; }
    if (Math.abs(dz) > 1e-6 && ok(pos.x, pos.z + dz)) { pos.z += dz; return true; }
    return false;
  }

  // Root pose that puts a character's hips on the seat cushion, facing out of the seat.
  seatPose(char, seat) {
    const h = char.sitOffset();
    const c = Math.cos(seat.yaw), s = Math.sin(seat.yaw);
    return {
      x: seat.hipX - (h.x * c + h.z * s),
      y: seat.y - (h.y - 0.1),
      z: seat.hipZ - (-h.x * s + h.z * c),
      yaw: seat.yaw,
      seat,
    };
  }

  // Is someone else (remote player or the AI) already sitting on this seat?
  // Remote players publish the id of the seat they occupy in their 'seat' state.
  seatTaken(seat, except) {
    if (except !== 'ai' && this.ai?.sit?.seat === seat) return true;
    if (except !== 'me' && this.me.sit?.seat === seat) return true;
    for (const r of this.remotes.values()) if (r.seen && r.p.getState('seat') === seat.id) return true;
    return false;
  }

  sitDown(seat) {
    if (this.seatTaken(seat, 'me')) { this.hud.toast('这个座位已经有人了'); return; }
    const me = this.me;
    me.sit = this.seatPose(me.char, seat);
    me.sitHold = true; // stay seated until the move input has been released once
    me.pos.set(me.sit.x, me.sit.y, me.sit.z);
    me.yaw = seat.yaw;
    me.anim = 'sit';
    me.char.play('sit');
    this.publishPose(seat.id);
  }

  standUp() {
    const me = this.me;
    const seat = me.sit?.seat;
    me.sit = null;
    me.sitHold = false;
    if (!seat) return;
    me.pos.set(seat.standX, this.area.height(seat.standX, seat.standZ), seat.standZ);
    this.unstick(me.pos);
    me.anim = 'idle';
    me.char.play('idle');
    this.publishPose('');
  }

  // Sends position, animation and seat together right away, so partners never see
  // a seated pose in the aisle (or a standing one inside a bench).
  publishPose(seatId) {
    const me = this.me, p = net.myPlayer();
    p.setState('seat', seatId, true);
    p.setState('a', me.anim, true);
    p.setState('p', [+me.pos.x.toFixed(2), +me.pos.y.toFixed(2), +me.pos.z.toFixed(2), +me.yaw.toFixed(2)], true);
    me.sendT = 0;
  }

  updateLocal(dt, t, g) {
    const me = this.me;
    const ch = me.char;
    const frozen = this.loading || this.hud.dialogOpen;
    const mv = frozen ? { x: 0, y: 0, run: false } : this.input.move();
    const yaw = this.cam.yaw;
    const dx = -Math.sin(yaw) * mv.y + Math.cos(yaw) * mv.x;
    const dz = -Math.cos(yaw) * mv.y - Math.sin(yaw) * mv.x;
    const mag = Math.hypot(dx, dz);
    let anim = 'idle';
    if (me.sit && mag <= 0.08) me.sitHold = false;
    if (mag > 0.08 && !(me.sit && me.sitHold)) {
      if (me.sit) this.standUp();
      const speed = (mv.run ? RUN : WALK) * Math.min(1, mag);
      const moved = this.moveWithCollision(me.pos, (dx / mag) * speed * dt, (dz / mag) * speed * dt);
      // Safety net: if input keeps getting rejected while we stand somewhere invalid, step out.
      me.blockedT = moved ? 0 : (me.blockedT || 0) + dt;
      if (me.blockedT > 0.4 && !this.isFree(me.pos.x, me.pos.z)) { this.unstick(me.pos); me.blockedT = 0; }
      me.yaw = angleLerp(me.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 12));
      anim = mv.run ? 'run' : 'walk';
    }
    if (me.sit) {
      me.pos.set(me.sit.x, me.sit.y, me.sit.z);
      me.yaw = me.sit.yaw;
      anim = 'sit';
    } else {
      const gy = this.area.height(me.pos.x, me.pos.z);
      me.pos.y += (gy - me.pos.y) * (1 - Math.exp(-dt * 18));
    }
    // Moving interrupts a one-shot (wave / pick up); otherwise let it finish.
    const interrupt = ch.busy && anim !== 'idle';
    if (interrupt || (!ch.busy && anim !== me.anim)) {
      me.anim = anim;
      ch.play(anim);
    }
    if (anim === 'walk') ch.setSpeed(1.15);
    ch.root.position.copy(me.pos);
    ch.root.rotation.y = me.yaw;
    ch.update(dt);

    // Interactions.
    const step = this.step(g);
    const fl = g.fl || {};
    for (const it of this.area.items) {
      if (it.ring) it.ring.visible = this.available(it, step, fl);
      if (it.obj && it.hideOnCollect) it.obj.visible = !(fl[it.group] || []).includes(it.id);
      if (it.obj && it.hideOnCollect && it.obj.visible) it.obj.rotation.y += dt * 0.8;
    }
    let best = null;
    if (!frozen && !me.sit) {
      let bestD = 1e9;
      for (const it of this.area.items) {
        if (!this.available(it, step, fl)) continue;
        if (it.kind === 'sit' && this.seatTaken(it.seat, 'me')) continue;
        const d = flat(me.pos, it.pos);
        if (d < it.r && d < bestD) { best = it; bestD = d; }
      }
    }
    if (me.sit && !frozen) {
      this.hud.prompt('起身');
      if (this.input.consume('KeyE')) this.standUp();
    } else {
      this.hud.prompt(best ? best.label : null);
      if (best && this.input.consume('KeyE')) this.interact(best);
    }
    if (!frozen && !me.sit && this.input.consume('KeyQ')) this.emote('wave');

    // Network.
    me.sendT += dt;
    if (me.sendT > SEND_DT) {
      me.sendT = 0;
      const p = net.myPlayer();
      p.setState('p', [+me.pos.x.toFixed(2), +me.pos.y.toFixed(2), +me.pos.z.toFixed(2), +me.yaw.toFixed(2)], false);
      if (p.getState('a') !== me.anim) p.setState('a', me.anim, true);
    }
  }

  available(it, step, fl) {
    if (it.kind === 'sit') return true;
    if (!step || it.active === false) return false;
    if ((step.type === 'collect' || step.type === 'ordered') && it.group === step.group) return !(fl[it.group] || []).includes(it.id);
    if (step.type === 'talk') return it.id === step.target;
    if (step.type === 'each') return it.id === step.target && !(fl.each || []).includes(net.myPlayer().id);
    return false;
  }

  interact(it) {
    if (it.kind === 'sit') {
      this.sitDown(it.seat);
      return;
    }
    if (it.anim !== 'none') this.emote(it.anim);
    this.audio.sfx(it.group === 'star' ? 'goal' : 'pickup');
    net.callHost('act', { id: it.id, from: net.myPlayer().id });
  }

  emote(name) {
    this.me.char.playOnce(name);
    this.me.anim = name;
    this.me.ev += 1;
    net.myPlayer().setState('e', `${name}:${this.me.ev}`, true);
    if (name === 'wave') {
      this.audio.sfx('wave');
      if (this.ai) this.ai.waveIn = 0.7;
    }
  }

  updateRemotes(dt) {
    for (const r of this.remotes.values()) {
      const p = r.p;
      const role = p.getState('role');
      if (!role) continue;
      // Two humans must never share a role (a joiner can pick before the other's role has synced):
      // the non-host yields, so whoever was already playing keeps their character.
      if (role === this.me.role && !net.isHost()) this.switchRole(otherRole(role));
      if (r.char && r.role !== role) { r.char.dispose(); r.char = null; }
      if (!r.char) {
        const name = p.getState('name') || '同伴';
        r.char = new Character(ROLES[role].model, { label: tag(name, role), color: ROLES[role].color });
        r.role = role;
        this.scene.add(r.char.root);
      }
      const here = p.getState('ld') === this.areaKey;
      const s = p.getState('p');
      if (s && here) {
        r.target.set(s[0], s[1], s[2]);
        if (!r.seen) { r.char.root.position.copy(r.target); r.yaw = s[3]; }
        r.seen = true;
        r.yaw = angleLerp(r.yaw, s[3], 1 - Math.exp(-dt * 10));
      } else r.seen = false;
      r.char.root.visible = r.seen && r.char.opacity > 0.01;
      if (r.char.root.position.distanceTo(r.target) > 1.2) r.char.root.position.copy(r.target);
      else r.char.root.position.lerp(r.target, 1 - Math.exp(-dt * 10));
      r.char.root.rotation.y = r.yaw;
      const ev = p.getState('e') || '';
      if (ev !== r.ev) {
        if (r.ev) r.char.playOnce(ev.split(':')[0]);
        r.ev = ev;
      }
      const a = p.getState('a') || 'idle';
      if (!r.char.busy && ['idle', 'walk', 'run', 'sit'].includes(a)) r.char.play(a);
      if (a === 'walk') r.char.setSpeed(1.15);
      r.char.update(dt);
    }
  }

  switchRole(role) {
    const me = this.me;
    me.role = role;
    net.myPlayer().setState('role', role, true);
    if (me.sit) this.standUp();
    me.char.dispose();
    me.char = new Character(ROLES[role].model);
    me.char.root.position.copy(me.pos);
    this.scene.add(me.char.root);
    me.anim = '';
    this.hud.setInvite(location.href, ROLES[role].name, ROLES[otherRole(role)].name, !this.online);
    this.hud.toast(`你现在扮演${ROLES[role].name}`);
  }

  // AI companion when you're travelling alone.
  updateAI(dt, t, g) {
    const solo = this.remotes.size === 0;
    if (solo && !this.ai && this.me.role) {
      const role = otherRole(this.me.role);
      const char = new Character(ROLES[role].model, { label: `${ROLES[role].name}（AI）`, color: ROLES[role].color });
      this.scene.add(char.root);
      this.ai = { role, char, pos: V(), yaw: 0, stuck: 0, anchor: V(), followT: V(), waveIn: 0, anim: '' };
      this.placeAI();
    } else if (!solo && this.ai) {
      this.ai.char.dispose();
      this.ai = null;
    }
    const ai = this.ai;
    if (!ai || !this.area || this.loading) return;
    const step = this.step(g);

    // When you sit, the AI takes the seat facing you; when you stand, it gets up too.
    const want = this.me.sit?.seat.partner;
    if (ai.sit && ai.sit.seat !== want) this.aiStand();
    if (ai.sit) {
      ai.waveIn = 0;
      ai.pos.set(ai.sit.x, ai.sit.y, ai.sit.z);
      ai.yaw = ai.sit.yaw;
      if (ai.anim !== 'sit') { ai.char.play('sit'); ai.anim = 'sit'; }
      ai.char.root.position.copy(ai.pos);
      ai.char.root.rotation.y = ai.yaw;
      ai.char.update(dt);
      return;
    }

    let target, stopAt, following = false;
    if (step?.type === 'plates' && step.plates.every((id) => this.area.points[id])) {
      const [a, b] = step.plates.map((id) => this.area.points[id]);
      target = flat(this.me.pos, a) < flat(this.me.pos, b) ? b : a;
      stopAt = 0.4;
    } else if (want && !this.seatTaken(want, 'ai')) {
      target = V().set(want.standX, 0, want.standZ);
      stopAt = 0.35;
      if (flat(ai.pos, target) <= stopAt && !this.hud.dialogOpen) {
        ai.sit = this.seatPose(ai.char, want);
        return;
      }
    } else if (this.me.sit) {
      target = this.me.pos;
      stopAt = 1.6;
    } else {
      // Walk a little behind and beside you (straight behind in narrow places like the carriage),
      // aiming at the nearest free spot so the target is never inside a bench or wall.
      const side = this.area.narrow ? 0 : 1.1;
      const s = Math.sin(this.me.yaw), c = Math.cos(this.me.yaw);
      target = ai.followT.set(this.me.pos.x - s * 1.2 + c * side, 0, this.me.pos.z - c * 1.2 - s * side);
      this.unstick(target);
      stopAt = 0.7;
      following = true;
    }
    const d = flat(ai.pos, target);
    let anim = 'idle';
    if (following && d > 14) { this.placeAI(); return; } // e.g. after a teleport or respawn
    if (d > stopAt && !this.hud.dialogOpen) {
      const run = d > 4 || step?.type === 'plates';
      const sp = (run ? RUN : WALK) * dt;
      // Steer around obstacles by trying progressively wider detours.
      const base = Math.atan2(target.x - ai.pos.x, target.z - ai.pos.z);
      let heading = base;
      for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
        const h = base + off;
        if (this.moveWithCollision(ai.pos, Math.sin(h) * sp, Math.cos(h) * sp)) { heading = h; break; }
      }
      // Stuck = less than 0.5 m of net progress toward the target for 1.5 s. (A per-frame test is
      // fooled by jittering against an obstacle such as the lighthouse.)
      if (flat(ai.anchor, target) - flat(ai.pos, target) > 0.5) { ai.anchor.copy(ai.pos); ai.stuck = 0; }
      else ai.stuck += dt;
      if (ai.stuck > 1.5) {
        ai.stuck = 0;
        if (this.area.walkable(target.x, target.z)) { ai.pos.set(target.x, ai.pos.y, target.z); this.unstick(ai.pos); }
        else this.placeAI();
        ai.anchor.copy(ai.pos);
      }
      ai.yaw = angleLerp(ai.yaw, heading, 1 - Math.exp(-dt * 10));
      anim = run ? 'run' : 'walk';
    } else {
      ai.anchor.copy(ai.pos);
      ai.stuck = 0;
      ai.yaw = angleLerp(ai.yaw, Math.atan2(this.me.pos.x - ai.pos.x, this.me.pos.z - ai.pos.z), 1 - Math.exp(-dt * 3));
    }
    ai.pos.y += (this.area.height(ai.pos.x, ai.pos.z) - ai.pos.y) * (1 - Math.exp(-dt * 18));
    if (ai.waveIn > 0) {
      ai.waveIn -= dt;
      if (ai.waveIn <= 0) ai.char.playOnce('wave');
    }
    if (!ai.char.busy && anim !== ai.anim) { ai.char.play(anim); ai.anim = anim; }
    if (anim === 'walk') ai.char.setSpeed(1.15);
    ai.char.root.position.copy(ai.pos);
    ai.char.root.rotation.y = ai.yaw;
    ai.char.update(dt);
  }

  placeAI() {
    const ai = this.ai;
    if (!ai || !this.area) return;
    ai.sit = null;
    const idx = ai.role === 'giovanni' ? 0 : 1;
    const [x, z, yaw] = this.area.spawns[idx];
    // Next to its own spawn when you're near it, otherwise the nearest free spot behind you
    // (never the far spawn, which would re-trigger the "too far" teleport every frame).
    const near = flat(this.me.pos, { x, z }) < 6;
    ai.pos.set(near ? x : this.me.pos.x - Math.sin(this.me.yaw) * 1.4, 0, near ? z : this.me.pos.z - Math.cos(this.me.yaw) * 1.4);
    this.unstick(ai.pos);
    if (!this.isFree(ai.pos.x, ai.pos.z)) { ai.pos.set(this.me.pos.x, 0, this.me.pos.z); this.unstick(ai.pos); }
    ai.pos.y = this.area.height(ai.pos.x, ai.pos.z);
    ai.anchor.copy(ai.pos);
    ai.stuck = 0;
    ai.yaw = yaw;
    ai.char.root.position.copy(ai.pos);
  }

  aiStand() {
    const ai = this.ai;
    const seat = ai.sit.seat;
    ai.sit = null;
    ai.anim = '';
    ai.pos.set(seat.standX, this.area.height(seat.standX, seat.standZ), seat.standZ);
    this.unstick(ai.pos);
  }

  // Campanella fades into light at the Coalsack and returns as a faint spirit at dawn.
  updateSpirit(dt) {
    let target = null;
    if (this.me.role === 'campanella') target = this.me.char;
    else if (this.ai?.role === 'campanella') target = this.ai.char;
    else for (const r of this.remotes.values()) if (r.p.getState('role') === 'campanella') target = r.char;
    if (!target) return;
    if (!this.spirit) { target.setOpacity(1); return; }
    this.spirit.t += dt;
    const fade = this.spirit.ghost ? 0.35 : Math.max(0, 1 - this.spirit.t / 4);
    target.setOpacity(this.me.role === 'campanella' ? Math.max(fade, 0.3) : fade);
  }

  updateCamera(dt) {
    const look = this.input.takeLook();
    const c = this.cam;
    c.yaw -= look.dx * 0.006;
    c.pitch = THREE.MathUtils.clamp(c.pitch + look.dy * 0.004, -0.15, 1.2);
    c.dist = THREE.MathUtils.clamp(c.dist + look.zoom * 0.5, 1.8, this.area.camMax);
    const focus = this._v.copy(this.me.pos);
    focus.y += this.me.sit ? 1.0 : 1.35;
    const cp = Math.cos(c.pitch);
    const desired = new THREE.Vector3(
      focus.x + Math.sin(c.yaw) * cp * c.dist,
      focus.y + Math.sin(c.pitch) * c.dist,
      focus.z + Math.cos(c.yaw) * cp * c.dist,
    );
    desired.y = Math.max(desired.y, this.area.height(desired.x, desired.z) + 0.35);
    // Pull the camera in front of anything it would clip into.
    const blocks = this.area.camBlocks;
    if (blocks.length) {
      const inside = (p) => blocks.some((b) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1 && p.y < b.y1);
      const probe = new THREE.Vector3();
      for (let i = 1; i <= 20; i++) {
        probe.lerpVectors(focus, desired, i / 20);
        if (inside(probe)) { desired.lerpVectors(focus, desired, Math.max(0.1, (i - 1) / 20)); break; }
      }
    }
    this.area.camClamp?.(desired);
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 9));
    this.camera.lookAt(focus);
    const sun = this.area.sun;
    sun.position.copy(this.me.pos).addScaledVector(this.area.sunDir, 40);
    sun.target.position.copy(this.me.pos);
  }

  updateHud(g, step) {
    let text = '';
    if (step && !this.hud.dialogOpen && step.text) {
      const fl = g.fl || {};
      text = step.text;
      if (step.need) text += `（${(fl[step.group] || []).length}/${step.need}）`;
      if (step.type === 'each') {
        const humans = this.party().filter((m) => m.human);
        text += `（${humans.filter((m) => (fl.each || []).includes(m.id)).length}/${humans.length}）`;
      }
    }
    this.hud.objective(text);
    this.hudT = (this.hudT || 0) + 1;
    if (this.hudT % 20 === 0) {
      const list = [{ label: `${tag(this.me.name, this.me.role)}（你）`, color: ROLES[this.me.role].color }];
      for (const r of this.remotes.values()) {
        const role = r.p.getState('role');
        if (role) list.push({ label: tag(r.p.getState('name') || '同伴', role), color: ROLES[role].color });
      }
      if (this.ai) list.push({ label: `${ROLES[this.ai.role].name}（AI）`, color: '#7f8aa8' });
      this.hud.party(list);
    }
  }

  dialogClick() {
    this.dlgClicked = true;
  }

  requestRestart() {
    net.callHost('restart', {});
  }
}
