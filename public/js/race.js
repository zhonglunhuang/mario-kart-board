import * as THREE from 'three';
import { KartPhysics, lerpAngle } from './kart-physics.js';
import { AIDriver } from './ai.js';
import { playAnim } from './models.js';

/* 比賽控制器：本地車物理、AI 車（房主模擬）、輸入（鍵盤 / 觸控 / 搖桿）、道具、投射物、特效、HUD、小地圖、網路同步 */
const DEFS = window.DEFS;
const D = DEFS.DURATIONS;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ITEM_KEYS = Object.keys(DEFS.ITEMS);

function fmtTime(ms) {
  if (ms == null) return '--:--.-';
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
function itemLabel(item) {
  if (!item) return '';
  const def = DEFS.ITEMS[item.id];
  return def ? `${def.emoji}${item.count > 1 ? `×${item.count}` : ''}` : '';
}

export class RaceController {
  constructor({ scene, socket, meId, state, room, isTouch, audio, prefs = {} }) {
    this.scene = scene;
    this.track = scene.track;
    this.socket = socket;
    this.meId = meId;
    this.isTouch = isTouch;
    this.audio = audio;
    this.prefs = prefs;
    this.laps = state.laps;
    this.phase = state.phase;
    this.startAt = state.startAt;
    this.hostId = state.hostId;
    this.difficulty = state.difficulty || 'normal';
    this.offset = null;
    this.players = new Map();
    this.snapPlayers = state.players;
    this.finished = false;
    this.item = null;
    this.roulette = null; // { until, final }
    this.bananas = [];
    this.boxAvail = state.boxes.map(() => true);
    this.boxCooldown = state.boxes.map(() => 0);
    this.myShells = [];
    this.remoteShells = [];
    this.remoteBombs = [];
    this.lastSend = 0;
    this.lastHud = 0;
    this.lastMini = 0;
    this.msgs = [];
    this.destroyed = false;
    this.autoGas = isTouch;
    this.useJoystick = isTouch && prefs.joystick !== false;
    this.input = { steer: 0, gas: 0, brake: false, drift: false, left: false, right: false, gasBtn: false, joy: 0, look: false };
    this.eff = { spinUntil: 0, boostUntil: 0, starUntil: 0, slowUntil: 0, goldenUntil: 0, localBoostUntil: 0 };
    this.showStandings = !isTouch;
    this.itemHold = null; // { since }
    this.trailing = false;
    this.lastBeep = null;
    this.wasStar = false;
    this.wasAir = false;
    this.driftLevel = 0;
    this.bots = new Map();

    const weather = scene.variant.weather;
    this.weatherGrip = weather === 'rain' ? 0.88 : weather === 'snow' ? 0.8 : 1;

    for (const p of state.players) {
      const k = scene.addKart(p, p.id === meId);
      const g = this.track.gridPose(p.seat);
      k.x = g.x; k.y = g.y; k.z = g.z; k.rot = g.rot; k.speed = 0; k.stamp = performance.now();
      k.dispX = g.x; k.dispY = g.y; k.dispZ = g.z; k.dispRot = g.rot;
      scene.poseKart(k, g.x, g.y, g.z, g.rot);
      this.players.set(p.id, { ...p });
    }
    const me = state.players.find((p) => p.id === meId);
    this.kartDef = DEFS.KARTS.find((k) => k.id === me?.kart) || DEFS.KARTS[0];
    this.localKart = scene.karts.get(meId);
    this.phys = new KartPhysics(this.kartDef, this.track, DEFS);
    const g = this.track.gridPose(me?.seat ?? 0);
    this.phys.place(g.x, g.y, g.z, g.rot, g.hint);
    scene.camera.position.set(g.x - Math.sin(g.rot) * 10, g.y + 5, g.z - Math.cos(g.rot) * 10);
    scene.camTarget.set(g.x, g.y, g.z);

    this.bindInput();
    this.buildMinimap();
    this.renderHelp();
    $('#hud-standings').classList.toggle('collapsed', !this.showStandings);
    $('#touch-controls').classList.toggle('hidden', !isTouch);
    $('#hud-keys').classList.toggle('hidden', isTouch);
    this.applyControlPrefs();
    this.center('準備…');
    scene.onFrame = (dt) => this.update(dt);
    this.onSnapshot(state);
    this.syncBots();
  }

  serverNow() {
    return Date.now() + (this.offset ?? 0);
  }

  /* ---------- 輸入 ---------- */
  bindInput() {
    const down = new Set();
    this.onKey = (e) => {
      if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const k = e.key;
      const map = {
        ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
        ArrowUp: 'gas', w: 'gas', W: 'gas', ArrowDown: 'brake', s: 'brake', S: 'brake',
        Shift: 'drift', x: 'drift', X: 'drift', z: 'drift', Z: 'drift', c: 'look', C: 'look',
      };
      if (map[k]) {
        e.preventDefault();
        if (e.type === 'keydown') down.add(map[k]);
        else down.delete(map[k]);
        this.input.left = down.has('left');
        this.input.right = down.has('right');
        this.input.gasBtn = down.has('gas');
        this.input.brake = down.has('brake');
        this.input.drift = down.has('drift');
        this.input.look = down.has('look');
      } else if (k === ' ' || k === 'Enter') {
        e.preventDefault();
        if (e.type === 'keydown' && !e.repeat) this.itemPress();
        else if (e.type === 'keyup') this.itemRelease();
      }
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);

    const hold = (id, prop) => {
      const el = $(id);
      if (!el) return;
      const set = (v) => (e) => {
        e.preventDefault();
        this.input[prop] = v;
      };
      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture?.(e.pointerId);
        set(true)(e);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, set(false));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold('#tc-left', 'left');
    hold('#tc-right', 'right');
    hold('#tc-gas', 'gasBtn');
    hold('#tc-brake', 'brake');
    hold('#tc-drift', 'drift');
    hold('#tc-look', 'look');
    const itemBtn = (el) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        this.itemPress();
      });
      for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, (e) => { e.preventDefault(); this.itemRelease(); });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    itemBtn($('#tc-item'));
    itemBtn($('#hud-item'));
    $('#tc-back').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.useItem(-1);
    });
    $('#tc-auto').onclick = () => {
      this.autoGas = !this.autoGas;
      this.applyControlPrefs();
    };
    $('#tc-mode').onclick = () => {
      this.useJoystick = !this.useJoystick;
      try { localStorage.setItem('mkb-joystick', this.useJoystick ? '1' : '0'); } catch (e) { /* ignore */ }
      this.applyControlPrefs();
    };
    $('#btn-standings').onclick = () => {
      this.showStandings = !this.showStandings;
      $('#hud-standings').classList.toggle('collapsed', !this.showStandings);
    };
    $('#btn-cam').onclick = () => {
      this.scene.camMode = this.scene.camMode === 'chase' ? 'far' : 'chase';
      this.scene.baseFov = this.scene.camMode === 'far' ? 70 : 62;
    };
    // 虛擬搖桿（左半螢幕拖曳）
    const joy = $('#joystick');
    const knob = $('#joystick-knob');
    let joyId = null;
    let origin = null;
    const R = 46;
    joy.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      joyId = e.pointerId;
      joy.setPointerCapture?.(e.pointerId);
      const r = joy.getBoundingClientRect();
      origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.joyMove(e, origin, knob, R);
    });
    joy.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyId || !origin) return;
      this.joyMove(e, origin, knob, R);
    });
    const joyEnd = (e) => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      origin = null;
      this.input.joy = 0;
      knob.style.transform = 'translate(0px, 0px)';
    };
    joy.addEventListener('pointerup', joyEnd);
    joy.addEventListener('pointercancel', joyEnd);
  }

  joyMove(e, origin, knob, R) {
    let dx = e.clientX - origin.x;
    let dy = e.clientY - origin.y;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx *= R / d;
      dy *= R / d;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const v = dx / R;
    this.input.joy = Math.abs(v) < 0.12 ? 0 : Math.sign(v) * Math.min(1, (Math.abs(v) - 0.12) / 0.88);
  }

  applyControlPrefs() {
    $('#tc-auto').textContent = `自動油門：${this.autoGas ? '開' : '關'}`;
    $('#tc-gas').classList.toggle('hidden', this.autoGas);
    $('#tc-mode').textContent = this.useJoystick ? '🕹️ 搖桿' : '◀▶ 按鈕';
    $('#joystick').classList.toggle('hidden', !this.useJoystick);
    $('#tc-btns').classList.toggle('hidden', this.useJoystick);
  }

  itemPress() {
    if (!this.item || this.roulette) return;
    const def = DEFS.ITEMS[this.item.id];
    this.itemHold = { since: performance.now(), trail: !!def.trail };
    if (def.trail) {
      this.trailing = true;
      this.scene.setTrail(this.localKart, def.uses || this.item.id);
    } else {
      // 不能拖的道具：按下就用
      this.itemHold = null;
      this.useItem(this.input.brake ? -1 : 1);
    }
  }

  itemRelease() {
    if (!this.itemHold) return;
    this.itemHold = null;
    this.trailing = false;
    this.scene.setTrail(this.localKart, null);
    this.useItem(this.input.brake ? -1 : 1);
  }

  useItem(dir = 1, as = null) {
    const item = as ? this.bots.get(as)?.item : this.item;
    if (!item || this.phase !== 'racing' || (!as && (this.finished || this.roulette))) return;
    const ph = as ? this.bots.get(as).phys : this.phys;
    const def = DEFS.ITEMS[item.id];
    const base = def.uses || item.id;
    // 金蘑菇：期間內每按一次就衝刺（本地判定）
    if (!as && base === 'golden' && this.serverNow() < this.eff.goldenUntil) {
      this.eff.localBoostUntil = this.serverNow() + 900;
      this.audio?.useItem('mushroom');
      return;
    }
    const fwd = { x: Math.sin(ph.rot), z: Math.cos(ph.rot) };
    const dist = base === 'banana' ? (dir > 0 ? 9 : 3.5) : 3.5;
    const payload = { x: ph.x + fwd.x * dist * dir, y: ph.y, z: ph.z + fwd.z * dist * dir, dir };
    if (as) payload.as = as;
    this.socket.emit('race:use', payload, (res) => {
      if (res?.error) this.flash(res.error);
    });
  }

  /* ---------- AI 車（房主模擬） ---------- */
  get isHost() {
    return this.hostId === this.meId;
  }

  syncBots() {
    if (!this.isHost) {
      this.bots.clear();
      return;
    }
    for (const p of this.snapPlayers || []) {
      if (!p.bot || p.dropped || this.bots.has(p.id)) continue;
      const kartDef = DEFS.KARTS.find((k) => k.id === p.kart) || DEFS.KARTS[0];
      const phys = new KartPhysics(kartDef, this.track, DEFS);
      const k = this.scene.karts.get(p.id);
      if (p.speed || p.x || p.z) {
        phys.place(p.x, p.y, p.z, p.rot, -1);
        phys.speed = p.speed;
      } else {
        const g = this.track.gridPose(p.seat);
        phys.place(g.x, g.y, g.z, g.rot, g.hint);
      }
      const ai = new AIDriver({ track: this.track, kartDef, difficulty: this.difficulty, defs: DEFS, seed: (p.seat + 1) * 0.137 });
      this.bots.set(p.id, { id: p.id, phys, ai, kartDef, item: p.item, kart: k, eff: { spinUntil: p.spinUntil, boostUntil: p.boostUntil, starUntil: p.starUntil, slowUntil: p.slowUntil }, shells: [], pending: null, finished: p.finished, localSpinUntil: 0 });
    }
  }

  updateBots(dt, now, racing) {
    if (!this.isHost) return;
    const humans = (this.snapPlayers || []).filter((p) => !p.bot && !p.dropped);
    const humanBest = humans.length ? Math.max(...humans.map((p) => p.lap + p.t)) : 0;
    for (const b of this.bots.values()) {
      const p = this.players.get(b.id);
      if (!p || p.dropped) continue;
      const ph = b.phys;
      const others = [];
      for (const [, k] of this.scene.karts) if (k.id !== b.id && !k.dropped) others.push({ id: k.id, x: k.dispX, z: k.dispZ, y: k.dispY, rot: k.dispRot, speed: k.speed, weight: k.weight });
      const boxes = this.scene.boxPositions.map((bp, i) => ({ x: bp.x, z: bp.z, available: this.boxAvail[i] }));
      const want = b.finished ? { steer: 0, gas: 0, brake: false, drift: false, limit: 1, useItem: null } : b.ai.decide(dt, ph, { others, boxes, item: b.item, myProgress: p.lap + p.t, humanBest, humanCount: humans.length });
      const spin = now < Math.max(b.eff.spinUntil, b.localSpinUntil);
      const fx = { spin, boost: now < b.eff.boostUntil, star: now < b.eff.starUntil, slow: now < b.eff.slowUntil, racing: racing && !b.finished, weatherGrip: this.weatherGrip };
      const ev = ph.step(dt, want, fx, now);
      for (const o of others) ph.collideWith(o, o.weight, fx.star);
      for (const e of ev) if (e.type === 'wall' && e.strength > 6) this.scene.particles.emit(ph.x, ph.y + 0.5, ph.z, { count: 6, color: '#ffd54f', size: 0.4, life: 0.3, speed: 5 });
      // 香蕉 / 道具箱（由房主代為回報）
      if (racing && !b.finished && !fx.star && !spin) {
        for (const ba of this.bananas) {
          if ((ph.x - ba.x) ** 2 + (ph.z - ba.z) ** 2 < 4) {
            b.localSpinUntil = now + D.spinMs;
            this.bananas = this.bananas.filter((x) => x.id !== ba.id);
            this.socket.emit('race:hit', { kind: 'banana', bananaId: ba.id, targetId: b.id }, () => {});
            break;
          }
        }
        if (!b.item) {
          this.scene.boxPositions.forEach((bp, i) => {
            if (!this.boxAvail[i]) return;
            if ((ph.x - bp.x) ** 2 + (ph.z - bp.z) ** 2 < 6.8) {
              this.boxAvail[i] = false;
              this.boxCooldown[i] = now + DEFS.ITEM_BOX_RESPAWN_MS;
              this.scene.setBoxes(this.boxAvail);
              this.socket.emit('race:pickup', { box: i, as: b.id }, () => {});
            }
          });
        }
        if (want.useItem && b.item) this.useItem(want.useItem.dir, b.id);
      }
      const k = b.kart;
      if (k) {
        k.speed = ph.speed;
        k.starOn = fx.star;
        k.x = ph.x; k.y = ph.y; k.z = ph.z; k.rot = ph.rot; k.stamp = performance.now(); k.air = ph.air;
        this.scene.poseKart(k, ph.x, ph.y, ph.z, ph.rot, ph.spinYaw, ph.lean, ph.pitch);
        this.emitKartFx(k, ph, fx, dt, false);
      }
    }
  }

  /* ---------- 伺服器同步 ---------- */
  onSnapshot(snap) {
    if (this.destroyed) return;
    const o = snap.now - Date.now();
    this.offset = this.offset === null ? o : this.offset * 0.9 + o * 0.1;
    this.phase = snap.phase;
    this.startAt = snap.startAt;
    this.laps = snap.laps;
    this.snapPlayers = snap.players;
    if (snap.hostId !== this.hostId) {
      this.hostId = snap.hostId;
      this.syncBots();
    }
    const nowP = performance.now();
    for (const p of snap.players) {
      this.players.set(p.id, p);
      const k = this.scene.karts.get(p.id);
      if (!k) continue;
      k.spinUntil = p.spinUntil;
      k.starOn = p.starUntil > this.serverNow();
      k.dropped = p.dropped;
      k.remoteDrift = p.drift;
      k.remoteAir = p.air;
      if (p.dropped) k.group.visible = false;
      if (p.trailing !== k.trailShown) {
        k.trailShown = p.trailing;
        if (p.id !== this.meId) this.scene.setTrail(k, p.trailing && p.item ? DEFS.ITEMS[p.item.id]?.uses || p.item.id : null);
      }
      if (p.id === this.meId) {
        if (!this.roulette) this.item = p.item;
        this.eff.spinUntil = Math.max(this.eff.spinUntil, p.spinUntil);
        this.eff.boostUntil = p.boostUntil;
        this.eff.starUntil = p.starUntil;
        this.eff.slowUntil = p.slowUntil;
        this.eff.goldenUntil = p.goldenUntil;
        if (p.finished && !this.finished) {
          this.finished = true;
          this.center(`🏁 完賽！第 ${p.rank} 名<br><small>${fmtTime(p.finishTime)}</small>`, 0);
          playAnim(this.localKart.body, p.rank === 1 ? 'win' : 'lose');
        }
        continue;
      }
      const b = this.bots.get(p.id);
      if (b) {
        b.item = p.item;
        b.eff = { spinUntil: p.spinUntil, boostUntil: p.boostUntil, starUntil: p.starUntil, slowUntil: p.slowUntil };
        if (p.finished && !b.finished) {
          b.finished = true;
          playAnim(k.body, p.rank === 1 ? 'win' : 'lose');
        }
        continue;
      }
      k.x = p.x; k.y = p.y; k.z = p.z; k.rot = p.rot; k.speed = p.speed; k.stamp = nowP;
    }
    this.bananas = snap.bananas;
    this.scene.syncBananas(snap.bananas);
    const mine = new Set([this.meId, ...this.bots.keys()]);
    this.remoteShells = snap.shells.filter((s) => !mine.has(s.owner));
    this.remoteBombs = (snap.bombs || []).filter((s) => !mine.has(s.owner)).map((b) => ({ ...b, kind: 'bomb' }));
    snap.boxes.forEach((ok, i) => {
      if (ok && this.boxCooldown[i] < this.serverNow()) this.boxAvail[i] = true;
      if (!ok) this.boxAvail[i] = false;
    });
    this.scene.setBoxes(this.boxAvail);
  }

  onEvent(ev) {
    if (this.destroyed) return;
    const name = (id) => this.players.get(id)?.name ?? '?';
    const I = DEFS.ITEMS;
    const mineOrBot = (id) => id === this.meId || this.bots.has(id);
    switch (ev.type) {
      case 'go':
        this.phase = 'racing';
        this.center('GO!', 900);
        this.vibrate(60);
        this.audio?.countdownBeep(0);
        this.audio?.say('開始！', { priority: true });
        this.audio?.music('race');
        break;
      case 'host':
        this.hostId = ev.hostId;
        this.syncBots();
        if (this.isHost) this.flash('你成為房主，接手電腦車手');
        break;
      case 'item':
        if (ev.playerId === this.meId) {
          this.roulette = { until: performance.now() + D.rouletteMs, final: ev.item };
          this.audio?.roulette();
        } else if (this.bots.has(ev.playerId)) {
          this.bots.get(ev.playerId).item = ev.item;
        }
        break;
      case 'use': {
        const owner = ev.playerId;
        if (mineOrBot(owner)) {
          const ph = owner === this.meId ? this.phys : this.bots.get(owner).phys;
          if (ev.shellId) this.fireShell(ev.shellId, ev.kind, ev.targetId, ev.dir, owner, ph);
          if (owner === this.meId) {
            this.item = ev.remaining > 0 ? { ...this.item, count: ev.remaining } : null;
            this.audio?.useItem(ev.item);
          } else {
            this.bots.get(owner).item = ev.remaining > 0 ? { ...this.bots.get(owner).item, count: ev.remaining } : null;
          }
        } else {
          this.flash(`${name(owner)} 使用了 ${I[ev.item].emoji} ${I[ev.item].name}`);
          this.audio?.click();
        }
        if (ev.item === 'lightning') {
          this.scene.lightningFlash();
          this.audio?.thunder();
          if (ev.victims?.includes(this.meId)) {
            this.eff.spinUntil = this.serverNow() + D.spinMs;
            this.center('⚡ 被閃電打中！', 1200);
            this.vibrate(150);
            playAnim(this.localKart.body, 'hit', { once: true });
            this.audio?.say('被閃電打中了！');
          }
          for (const v of ev.victims || []) {
            const b = this.bots.get(v);
            if (b) b.localSpinUntil = this.serverNow() + D.spinMs;
          }
        }
        if (ev.item === 'star' && owner === this.meId) this.audio?.say('無敵！');
        break;
      }
      case 'hit': {
        const k = this.scene.karts.get(ev.playerId);
        if (k) {
          this.scene.particles.emit(k.dispX, k.dispY + 1, k.dispZ, { count: 20, color: '#ffab40', size: 0.7, life: 0.5, speed: 8, gravity: 15 });
          playAnim(k.body, 'hit', { once: true });
        }
        if (ev.playerId === this.meId) {
          this.eff.spinUntil = Math.max(this.eff.spinUntil, this.serverNow() + D.spinMs);
          const what = ev.kind === 'banana' ? '🍌 踩到香蕉' : ev.kind === 'bomb' ? '💣 被炸到' : `${I[ev.item]?.emoji ?? '💥'} 被 ${name(ev.by)} 打中`;
          this.center(what, 1200);
          this.vibrate(150);
          this.scene.shakeCam(0.9);
          this.audio?.hit();
          this.audio?.say(ev.kind === 'banana' ? '踩到香蕉了！' : '被打中了！');
        } else {
          const b = this.bots.get(ev.playerId);
          if (b) b.localSpinUntil = this.serverNow() + D.spinMs;
          if (ev.by === this.meId) this.flash(`💥 打中 ${name(ev.playerId)}！`);
          else this.flash(`${name(ev.playerId)} ${ev.kind === 'banana' ? '踩到香蕉' : '被擊中'}`);
        }
        break;
      }
      case 'blocked':
        if (ev.playerId === this.meId) {
          this.flash('🛡️ 擋下了龜殼！');
          this.audio?.click();
          this.item = ev.item;
        } else this.flash(`${name(ev.playerId)} 擋下了龜殼`);
        break;
      case 'lap':
        if (ev.playerId === this.meId) {
          const last = ev.lap === this.laps - 1;
          this.center(last ? '最後一圈！' : `第 ${ev.lap + 1} 圈`, 1500);
          this.vibrate(40);
          this.audio?.lap();
          this.audio?.say(last ? '最後一圈！' : `第${ev.lap + 1}圈`);
          if (last) this.audio?.music('final');
        }
        break;
      case 'finish':
        this.flash(`🏁 ${ev.name} 完賽，第 ${ev.rank} 名（${fmtTime(ev.time)}）`);
        if (ev.playerId === this.meId) {
          this.audio?.finish(ev.rank);
          this.audio?.music('finish');
          this.audio?.say(ev.rank === 1 ? '恭喜！第一名完賽！' : `完賽，第${ev.rank}名`, { priority: true });
        } else this.audio?.click();
        break;
      case 'leave':
        this.flash(`${ev.name} 離開了比賽`);
        this.scene.removeKart(ev.playerId);
        break;
      case 'box':
        if (!mineOrBot(ev.playerId)) this.boxAvail[ev.index] = false;
        break;
      default:
        break;
    }
  }

  vibrate(ms) {
    try {
      navigator.vibrate?.(ms);
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------- 投射物（由發射者模擬） ---------- */
  fireShell(id, kind, targetId, dir, owner, ph) {
    const yaw = ph.rot + (dir < 0 ? Math.PI : 0);
    const dirV = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const pos = new THREE.Vector3(ph.x, ph.y, ph.z).add(dirV.clone().multiplyScalar(3.5));
    const s = { id, kind, pos, dir: dirV, speed: kind === 'bomb' ? 22 : 52, born: performance.now(), hint: ph.hint, targetId, owner, bounces: 0, vy: kind === 'bomb' ? 9 : 0, landedAt: 0 };
    if (kind === 'blue') {
      s.speed = 60;
      s.idx = ph.hint;
      s.pos.y += 3;
    }
    this.myShells.push(s);
    if (kind === 'bomb') this.audio?.whoosh();
  }

  updateShells(dt) {
    const nowP = performance.now();
    const now = this.serverNow();
    const owned = (o) => o === this.meId || this.bots.has(o);
    for (let i = this.myShells.length - 1; i >= 0; i--) {
      const s = this.myShells[i];
      const age = nowP - s.born;
      if (age > 9000) {
        this.myShells.splice(i, 1);
        continue;
      }
      if (s.kind === 'blue') {
        // 沿賽道中心線飛向目標
        s.idx += (s.speed * dt) / (this.track.length / 2400);
        const sm = this.track.at(s.idx);
        s.pos.set(sm.pos.x, sm.pos.y + 3 + Math.sin(nowP / 150) * 0.3, sm.pos.z);
        const tk = s.targetId ? this.scene.karts.get(s.targetId) : null;
        if (tk && !tk.dropped) {
          const d = Math.hypot(tk.dispX - s.pos.x, tk.dispZ - s.pos.z);
          if (d < 5) {
            this.scene.explode(tk.dispX, tk.dispY, tk.dispZ, true);
            this.audio?.explode();
            const targets = [];
            for (const [, k] of this.scene.karts) if (!k.dropped && Math.hypot(k.dispX - tk.dispX, k.dispZ - tk.dispZ) < 7) targets.push(k.id);
            this.socket.emit('race:hit', { kind: 'bomb', targets, item: 'blue', by: s.owner }, () => {});
            this.myShells.splice(i, 1);
          }
        } else if (age > 8000) this.myShells.splice(i, 1);
        continue;
      }
      if (s.kind === 'bomb') {
        if (!s.landedAt) {
          s.vy -= 30 * dt;
          s.pos.addScaledVector(s.dir, s.speed * dt);
          s.pos.y += s.vy * dt;
          const c = this.track.closest(s.pos, s.hint);
          s.hint = c.idx;
          if (s.pos.y <= c.center.y) {
            s.pos.y = c.center.y;
            s.landedAt = nowP;
          }
          const lim = this.track.half + 0.5;
          if (Math.abs(c.lateral) > lim) {
            s.pos.x = c.center.x + c.right.x * Math.sign(c.lateral) * lim;
            s.pos.z = c.center.z + c.right.z * Math.sign(c.lateral) * lim;
            s.speed = 0;
          }
        }
        let boom = s.landedAt && nowP - s.landedAt > 1400;
        for (const [, k] of this.scene.karts) {
          if (k.dropped || (k.id === s.owner && age < 800)) continue;
          if (Math.hypot(k.dispX - s.pos.x, k.dispZ - s.pos.z) < 2.2) boom = true;
        }
        if (boom) {
          this.scene.explode(s.pos.x, s.pos.y, s.pos.z, true);
          this.audio?.explode();
          const targets = [];
          for (const [, k] of this.scene.karts) if (!k.dropped && Math.hypot(k.dispX - s.pos.x, k.dispZ - s.pos.z) < 6.5) targets.push(k.id);
          if (targets.length) this.socket.emit('race:hit', { kind: 'bomb', targets, item: 'bomb', by: s.owner }, () => {});
          for (const id of targets) this.applyLocalSpin(id, now);
          this.myShells.splice(i, 1);
        }
        continue;
      }
      if (s.kind === 'red') {
        const tk = s.targetId ? this.scene.karts.get(s.targetId) : null;
        if (tk && !tk.dropped) {
          const want = new THREE.Vector3(tk.dispX - s.pos.x, 0, tk.dispZ - s.pos.z).normalize();
          const ang = Math.atan2(s.dir.x, s.dir.z);
          const na = lerpAngle(ang, Math.atan2(want.x, want.z), Math.min(1, 5 * dt));
          s.dir.set(Math.sin(na), 0, Math.cos(na));
        }
      }
      s.pos.addScaledVector(s.dir, s.speed * dt);
      const c = this.track.closest(s.pos, s.hint);
      s.hint = c.idx;
      const lim = this.track.half;
      if (Math.abs(c.lateral) > lim) {
        const sign = Math.sign(c.lateral);
        s.pos.x = c.center.x + c.right.x * sign * lim;
        s.pos.z = c.center.z + c.right.z * sign * lim;
        const dot = s.dir.x * c.right.x + s.dir.z * c.right.z;
        s.dir.x -= 2 * dot * c.right.x;
        s.dir.z -= 2 * dot * c.right.z;
        s.dir.normalize();
        s.bounces++;
        this.scene.particles.emit(s.pos.x, s.pos.y + 0.5, s.pos.z, { count: 8, color: '#ffd54f', size: 0.4, life: 0.3, speed: 5 });
        if (s.kind === 'red' || s.bounces > 4) {
          this.myShells.splice(i, 1);
          continue;
        }
      }
      s.pos.y = c.center.y;
      let hit = false;
      for (const [, k] of this.scene.karts) {
        if (k.dropped) continue;
        if (k.id === s.owner && (age < 900 || s.bounces === 0)) continue;
        if (owned(k.id) && k.id !== s.owner && age < 300) continue;
        const dx = k.dispX - s.pos.x, dz = k.dispZ - s.pos.z;
        if (dx * dx + dz * dz < 2.4 * 2.4) {
          this.socket.emit('race:hit', { kind: 'shell', targetId: k.id, item: s.kind, by: s.owner }, () => {});
          this.applyLocalSpin(k.id, now);
          this.scene.particles.emit(s.pos.x, s.pos.y + 0.8, s.pos.z, { count: 18, color: s.kind === 'red' ? '#ff5252' : '#69f0ae', size: 0.6, life: 0.4, speed: 7 });
          this.audio?.shellHit();
          hit = true;
          break;
        }
      }
      if (hit) this.myShells.splice(i, 1);
    }
  }

  applyLocalSpin(id, now) {
    if (id === this.meId) {
      if (now < this.eff.starUntil || this.trailing) return;
      this.eff.spinUntil = Math.max(this.eff.spinUntil, now + D.spinMs);
    } else {
      const b = this.bots.get(id);
      if (b && now >= b.eff.starUntil) b.localSpinUntil = now + D.spinMs;
    }
  }

  /* ---------- 特效 ---------- */
  emitKartFx(k, ph, fx, dt, isLocal) {
    const P = this.scene.particles;
    const th = this.scene.theme;
    const fwdX = Math.sin(ph.rot), fwdZ = Math.cos(ph.rot);
    const rX = Math.cos(ph.rot), rZ = -Math.sin(ph.rot);
    const rear = (side) => ({ x: ph.x - fwdX * 1.3 + rX * side * 0.85, y: ph.y + 0.25, z: ph.z - fwdZ * 1.3 + rZ * side * 0.85 });
    const spd = Math.abs(ph.speed);
    // 漂移火花 + 輪胎痕
    if (ph.drift.active && !ph.air) {
      const col = ph.drift.level > 0 ? DEFS.DRIFT.colors[ph.drift.level - 1] : '#ffffff';
      for (const side of [-1, 1]) {
        const r = rear(side);
        if (Math.random() < (ph.drift.level > 0 ? 0.9 : 0.5)) P.emit(r.x, r.y, r.z, { count: 2, color: col, size: 0.45 + ph.drift.level * 0.15, life: 0.35, speed: 5, spread: 0.3, gravity: 12, dir: { x: -fwdX, y: 0.5, z: -fwdZ } });
        this.scene.skids.add(`${k.id}${side}`, r.x, ph.y, r.z, rX, rZ, 0.38, 0.9);
      }
    } else {
      this.scene.skids.break(`${k.id}-1`);
      this.scene.skids.break(`${k.id}1`);
    }
    // 煞車痕
    if (isLocal && this.input.brake && spd > 10 && !ph.air) for (const side of [-1, 1]) { const r = rear(side); this.scene.skids.add(`${k.id}b${side}`, r.x, ph.y, r.z, rX, rZ, 0.36, 0.7); }
    else { this.scene.skids.break(`${k.id}b-1`); this.scene.skids.break(`${k.id}b1`); }
    // 排氣 / 加速火焰
    if (fx.boost || ph.boosting) {
      const r = rear(0);
      P.emit(r.x, r.y + 0.2, r.z, { count: 3, color: '#ff9100', size: 1.1, life: 0.25, speed: 9, spread: 0.4, dir: { x: -fwdX, y: 0.2, z: -fwdZ } });
      P.emit(r.x, r.y + 0.2, r.z, { count: 1, color: '#ffd54f', size: 0.7, life: 0.2, speed: 12, spread: 0.2, dir: { x: -fwdX, y: 0.2, z: -fwdZ } });
    } else if (spd > 5 && Math.random() < 0.35) {
      const r = rear(0);
      P.emit(r.x, r.y, r.z, { count: 1, color: '#9e9e9e', size: 0.7, life: 0.6, speed: 1.5, spread: 0.3, dir: { x: -fwdX, y: 0.6, z: -fwdZ }, gravity: -1 });
    }
    // 出界揚塵
    if (ph.offroad && spd > 8 && !ph.air) {
      const r = rear(Math.random() < 0.5 ? -1 : 1);
      P.emit(r.x, r.y, r.z, { count: 2, color: th.dust || '#c9b58a', size: 1.2, life: 0.7, speed: 3, spread: 0.6, gravity: 2 });
    }
    // 無敵星星閃光
    if (fx.star) P.emit(ph.x, ph.y + 1, ph.z, { count: 2, color: ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb'][Math.floor(Math.random() * 5)], size: 0.7, life: 0.5, speed: 3, spread: 1.6 });
    // 動作：騰空 / 落地
    if (ph.air && !ph.hop && !k.wasAir) { playAnim(k.body, 'jump'); k.wasAir = true; }
    if (!ph.air && k.wasAir) { playAnim(k.body, 'drive'); k.wasAir = false; k.squash = 1; }
    for (const e of ph.events) {
      if (e.type === 'land' && e.impact > 6) {
        P.emit(ph.x, ph.y + 0.1, ph.z, { count: 16, color: th.dust || '#cccccc', size: 1.1, life: 0.6, speed: 5, spread: 1.2, gravity: 4 });
        if (isLocal) { this.scene.shakeCam(Math.min(1, e.impact / 20)); this.audio?.land(e.impact); }
      }
      if (e.type === 'jump' && isLocal) this.audio?.jump();
      if (e.type === 'wall' && e.strength > 4) {
        P.emit(ph.x, ph.y + 0.6, ph.z, { count: 14, color: '#ffd54f', size: 0.5, life: 0.35, speed: 7, spread: 0.5, gravity: 10 });
        if (isLocal) { this.scene.shakeCam(Math.min(0.9, e.strength / 30)); this.audio?.wall(e.strength); this.vibrate(30); }
      }
      if (e.type === 'driftLevel' && isLocal) { this.audio?.driftLevel(e.level); }
      if (e.type === 'driftBoost' && isLocal) { this.audio?.boost(); this.flash(['', '藍火加速！', '橘火加速！', '紫火超級加速！'][e.level]); }
      if (e.type === 'driftStart' && isLocal) this.audio?.skidStart();
      if (e.type === 'driftEnd' || e.type === 'driftBoost') if (isLocal) this.audio?.skidStop();
    }
  }

  /* ---------- 每幀 ---------- */
  update(dt) {
    if (this.destroyed) return;
    const now = this.serverNow();
    const ph = this.phys;
    const eff = this.eff;
    const spinning = now < eff.spinUntil;
    const boost = now < eff.boostUntil || now < eff.localBoostUntil;
    const star = now < eff.starUntil;
    const slow = now < eff.slowUntil;
    const racing = this.phase === 'racing' && !this.finished;

    const inp = this.input;
    const steerBtn = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    inp.steer = this.useJoystick && this.isTouch ? inp.joy : steerBtn;
    inp.gas = inp.gasBtn || (this.autoGas && this.isTouch && !inp.brake) ? 1 : 0;

    const fx = { spin: spinning, boost, star, slow, racing, weatherGrip: this.weatherGrip };
    ph.step(dt, inp, fx, now);
    // 車與車碰撞
    for (const [, k] of this.scene.karts) {
      if (k.isLocal || k.dropped) continue;
      const r = ph.collideWith({ x: k.dispX, y: k.dispY, z: k.dispZ, rot: k.dispRot, speed: k.speed }, k.weight, star);
      if (r && r.strength > 3 && !k.pushed) {
        k.pushed = true;
        this.audio?.bump(r.strength);
        this.scene.shakeCam(Math.min(0.6, r.strength / 25));
        this.scene.particles.emit(ph.x, ph.y + 0.6, ph.z, { count: 8, color: '#ffffff', size: 0.5, life: 0.3, speed: 5 });
      } else if (!r) k.pushed = false;
    }
    // 香蕉
    if (racing && !star && !spinning) {
      for (const b of this.bananas) {
        if ((ph.x - b.x) ** 2 + (ph.z - b.z) ** 2 < 4) {
          eff.spinUntil = now + D.spinMs;
          this.bananas = this.bananas.filter((x) => x.id !== b.id);
          this.socket.emit('race:hit', { kind: 'banana', bananaId: b.id, targetId: this.meId }, () => {});
          break;
        }
      }
    }
    // 道具箱
    if (racing && !this.item && !this.roulette) {
      this.scene.boxPositions.forEach((bp, i) => {
        if (!this.boxAvail[i]) return;
        if ((ph.x - bp.x) ** 2 + (ph.z - bp.z) ** 2 < 6.8) {
          this.boxAvail[i] = false;
          this.boxCooldown[i] = now + DEFS.ITEM_BOX_RESPAWN_MS;
          this.scene.setBoxes(this.boxAvail);
          this.audio?.pickup();
          this.socket.emit('race:pickup', { box: i }, () => {});
        }
      });
    }
    if (this.roulette && performance.now() > this.roulette.until) {
      this.item = this.roulette.final;
      this.roulette = null;
      const def = DEFS.ITEMS[this.item.id];
      this.flash(`拿到 ${def.emoji} ${def.name}`);
      this.audio?.itemGet();
      this.audio?.say(`拿到${def.name}`);
    }

    this.updateBots(dt, now, this.phase === 'racing');
    this.updateShells(dt);

    const lk = this.localKart;
    if (lk) {
      lk.speed = ph.speed;
      lk.starOn = star;
      lk.air = ph.air;
      this.scene.poseKart(lk, ph.x, ph.y, ph.z, ph.rot, ph.spinYaw, ph.lean, ph.pitch);
      this.emitKartFx(lk, ph, fx, dt, true);
    }
    if (spinning && !this.wasSpin) playAnim(lk.body, 'hit', { once: true });
    this.wasSpin = spinning;

    // 遠端車：預測 + 平滑
    const nowP = performance.now();
    for (const [, k] of this.scene.karts) {
      if (k.isLocal || k.dropped || this.bots.has(k.id)) continue;
      const age = Math.min(0.25, (nowP - k.stamp) / 1000);
      const px = k.x + Math.sin(k.rot) * k.speed * age;
      const pz = k.z + Math.cos(k.rot) * k.speed * age;
      const s = 1 - Math.pow(0.0001, dt);
      const nx = THREE.MathUtils.lerp(k.dispX, px, s);
      const nz = THREE.MathUtils.lerp(k.dispZ, pz, s);
      const ny = THREE.MathUtils.lerp(k.dispY, k.y, s);
      const nrot = lerpAngle(k.dispRot, k.rot, s);
      if (now < (k.spinUntil || 0)) k.spinPhase += dt * ((Math.PI * 4) / (D.spinMs / 1000));
      else k.spinPhase = 0;
      this.scene.poseKart(k, nx, ny, nz, nrot, k.spinPhase, k.remoteDrift ? -0.12 : 0);
      if (k.remoteDrift > 0 && Math.random() < 0.6) {
        const col = DEFS.DRIFT.colors[k.remoteDrift - 1];
        this.scene.particles.emit(k.dispX - Math.sin(k.dispRot) * 1.3, k.dispY + 0.25, k.dispZ - Math.cos(k.dispRot) * 1.3, { count: 2, color: col, size: 0.5, life: 0.35, speed: 4, spread: 0.8, gravity: 10 });
      }
    }

    const botShells = [...this.bots.values()].flatMap(() => []);
    void botShells;
    this.scene.syncShells([
      ...this.myShells.map((s) => ({ id: s.id, kind: s.kind, x: s.pos.x, y: s.pos.y, z: s.pos.z, owned: true })),
      ...this.remoteShells,
      ...this.remoteBombs,
    ]);

    // 鏡頭
    const speedNorm = Math.min(1, Math.abs(ph.speed) / this.kartDef.maxSpeed);
    this.scene.chase(lk, dt, { finished: this.finished, reverse: inp.look && racing, orbit: this.phase === 'countdown' && now < this.startAt - 1200, boost: boost || ph.boosting, speedNorm });

    // 音效：引擎 / 漂移
    this.audio?.engineUpdate(speedNorm, racing ? inp.gas : 0, boost || ph.boosting, ph.air);
    const starNow = star;
    if (starNow !== this.wasStar) {
      this.wasStar = starNow;
      if (starNow) this.audio?.starStart();
      else this.audio?.starStop();
    }

    // 網路：每 50ms 回報（含 AI 車）
    if (nowP - this.lastSend > 50) {
      this.lastSend = nowP;
      const shellsOf = (owner) => this.myShells.filter((s) => s.owner === owner && s.kind !== 'bomb').map((s) => ({ id: s.id, kind: s.kind, x: s.pos.x, y: s.pos.y, z: s.pos.z }));
      const bombsOf = (owner) => this.myShells.filter((s) => s.owner === owner && s.kind === 'bomb').map((s) => ({ id: s.id, x: s.pos.x, y: s.pos.y, z: s.pos.z }));
      const payload = { ...ph.snapshot(), trail: this.trailing, shells: shellsOf(this.meId), bombs: bombsOf(this.meId) };
      if (this.isHost && this.bots.size) payload.bots = [...this.bots.values()].map((b) => ({ id: b.id, ...b.phys.snapshot(), shells: shellsOf(b.id), bombs: bombsOf(b.id) }));
      this.socket.volatile.emit('race:state', payload);
    }
    if (nowP - this.lastHud > (this.isTouch ? 180 : 100)) {
      this.lastHud = nowP;
      this.renderHud(now);
    }
    if (nowP - this.lastMini > (this.isTouch ? 200 : 120)) {
      this.lastMini = nowP;
      this.drawMinimap();
    }
  }

  /* ---------- HUD ---------- */
  center(html, ms = 1500) {
    const el = $('#hud-center');
    el.innerHTML = html;
    el.classList.add('show');
    clearTimeout(this.centerTimer);
    if (ms > 0) this.centerTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  flash(text) {
    if (!text) return;
    this.msgs.push({ text, at: performance.now() });
    if (this.msgs.length > 4) this.msgs.shift();
    this.renderMsgs();
  }

  renderMsgs() {
    const nowP = performance.now();
    this.msgs = this.msgs.filter((m) => nowP - m.at < 5000);
    $('#hud-msg').innerHTML = this.msgs.map((m) => `<div class="line">${esc(m.text)}</div>`).join('');
  }

  renderHud(now) {
    const me = this.players.get(this.meId);
    const lapNow = Math.min(this.laps, (me?.lap ?? 0) + 1);
    const setText = (sel, txt) => { const el = $(sel); if (el && el.textContent !== txt) el.textContent = txt; };
    setText('#hud-lap', `第 ${lapNow} / ${this.laps} 圈`);
    setText('#hud-pos', `第 ${me?.standing ?? 1} 名`);
    setText('#hud-speed', `${Math.round(Math.abs(this.phys.speed) * 2.6)} km/h`);
    const slot = $('#hud-item');
    const tcItem = $('#tc-item');
    const nameEl = $('#hud-item-name');
    const backBtn = $('#tc-back');
    if (this.roulette) {
      const pick = DEFS.ITEMS[ITEM_KEYS[Math.floor(performance.now() / 70) % ITEM_KEYS.length]];
      slot.textContent = pick.emoji.slice(0, 2);
      tcItem.textContent = pick.emoji.slice(0, 2);
      slot.classList.add('rolling');
      tcItem.classList.add('rolling');
      nameEl.classList.add('hidden');
    } else if (this.item) {
      const it = DEFS.ITEMS[this.item.id];
      slot.textContent = itemLabel(this.item);
      slot.classList.add('usable');
      slot.classList.remove('rolling');
      slot.title = `${it.name}：${it.desc}`;
      tcItem.textContent = itemLabel(this.item);
      tcItem.classList.add('usable');
      tcItem.classList.remove('rolling');
      nameEl.textContent = `${it.name}｜${it.desc}${it.throwable ? '（按住煞車再丟 = 往後丟）' : ''}`;
      nameEl.classList.remove('hidden');
      backBtn.classList.toggle('hidden', !it.throwable);
    } else {
      slot.textContent = '·';
      slot.classList.remove('usable', 'rolling');
      slot.title = '沒有道具';
      tcItem.textContent = '🎁';
      tcItem.classList.remove('usable', 'rolling');
      nameEl.classList.add('hidden');
      backBtn.classList.add('hidden');
    }
    if (this.phase === 'countdown') {
      const left = Math.ceil((this.startAt - now) / 1000);
      if (left > 0 && left <= 3) {
        this.center(String(left), 0);
        if (this.lastBeep !== left) {
          this.lastBeep = left;
          this.audio?.countdownBeep(left);
          this.audio?.say(['', '一', '二', '三'][left], { priority: true });
        }
      } else if (left > 3) this.center('準備…', 0);
    }
    // 漂移蓄力條
    const dbar = $('#drift-bar');
    if (this.phys.drift.active) {
      const D2 = DEFS.DRIFT;
      const pct = Math.min(1, this.phys.drift.charge / D2.levels[2]);
      dbar.classList.remove('hidden');
      dbar.querySelector('i').style.width = `${Math.round(pct * 100)}%`;
      dbar.querySelector('i').style.background = this.phys.drift.level > 0 ? D2.colors[this.phys.drift.level - 1] : '#ffffff';
    } else dbar.classList.add('hidden');

    const list = (this.snapPlayers || []).filter((p) => !p.dropped).sort((a, b) => a.standing - b.standing);
    const standingsHtml = list
      .map((p) => {
        const ch = DEFS.CHARACTERS.find((c) => c.id === p.character);
        const status = p.finished ? `🏁 ${fmtTime(p.finishTime)}` : `第 ${Math.min(this.laps, p.lap + 1)} 圈`;
        return `<div class="st-row${p.id === this.meId ? ' me' : ''}"><span class="rank">${p.standing}</span><span class="dot" style="background:${ch?.color}"></span><span class="name">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span><span class="it">${itemLabel(p.item)}</span><span class="sub">${status}</span></div>`;
      })
      .join('');
    if (standingsHtml !== this.lastStandingsHtml) {
      this.lastStandingsHtml = standingsHtml;
      $('#hud-standings').innerHTML = standingsHtml;
    }
    this.renderMsgs();
    const badges = [];
    if (now < this.eff.starUntil) badges.push('⭐ 無敵');
    if (now < this.eff.goldenUntil) badges.push('🌟🍄 金蘑菇（連按道具）');
    if (now < this.eff.boostUntil) badges.push('🍄 加速');
    if (now < this.eff.slowUntil) badges.push('⚡ 減速');
    if (this.trailing) badges.push('🛡️ 拖曳中');
    $('#hud-fx').textContent = badges.join(' ');
  }

  /* ---------- 小地圖 ---------- */
  buildMinimap() {
    const cv = $('#minimap');
    const pts = this.track.samples.filter((_, i) => i % 6 === 0).map((s) => [s.pos.x, s.pos.z]);
    const B = this.track.bounds;
    const pad = 14;
    const sc = Math.min((cv.width - pad * 2) / (B.maxX - B.minX), (cv.height - pad * 2) / (B.maxZ - B.minZ));
    this.mini = { cv, pts, sc, minX: B.minX, minZ: B.minZ, ox: (cv.width - (B.maxX - B.minX) * sc) / 2, oz: (cv.height - (B.maxZ - B.minZ) * sc) / 2 };
  }
  miniXY(x, z) {
    const m = this.mini;
    return [m.ox + (x - m.minX) * m.sc, m.oz + (z - m.minZ) * m.sc];
  }
  drawMinimap() {
    const m = this.mini;
    const ctx = m.cv.getContext('2d');
    ctx.clearRect(0, 0, m.cv.width, m.cv.height);
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    m.pts.forEach(([x, z], i) => {
      const [px, py] = this.miniXY(x, z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#3d3d46';
    ctx.stroke();
    const [sx, sy] = this.miniXY(m.pts[0][0], m.pts[0][1]);
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx - 4, sy - 4, 8, 8);
    for (const [, k] of this.scene.karts) {
      if (k.dropped) continue;
      const [px, py] = this.miniXY(k.dispX, k.dispZ);
      ctx.beginPath();
      ctx.arc(px, py, k.isLocal ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = k.color;
      ctx.fill();
      ctx.lineWidth = k.isLocal ? 2.5 : 1;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  }

  renderHelp() {
    $('#help-items').innerHTML = Object.values(DEFS.ITEMS)
      .map((t) => `<div class="legend"><div class="e">${t.emoji.slice(0, 2)}</div><div><b>${esc(t.name)}</b>${esc(t.desc)}</div></div>`)
      .join('');
    $('#help-karts').innerHTML = DEFS.KARTS.map((k) => `<div class="legend"><div class="e">${k.emoji}</div><div><b>${esc(k.name)}</b>${esc(k.desc)}</div></div>`).join('');
  }

  destroy() {
    this.destroyed = true;
    this.audio?.engineStop();
    this.audio?.music(null);
    this.scene.onFrame = null;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    clearTimeout(this.centerTimer);
    $('#hud-center').classList.remove('show');
    for (const id of [...this.scene.karts.keys()]) this.scene.removeKart(id);
    this.scene.syncShells([]);
    this.scene.syncBananas([]);
  }
}
