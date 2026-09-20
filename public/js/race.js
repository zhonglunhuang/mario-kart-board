import * as THREE from 'three';

/* 本地車輛物理、輸入、網路同步、HUD、小地圖 */
const DEFS = window.DEFS;
const D = DEFS.DURATIONS;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
function fmtTime(ms) {
  if (ms == null) return '--:--.-';
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

export class RaceController {
  constructor({ scene, socket, meId, state, room, isTouch, onOver, audio }) {
    this.scene = scene;
    this.audio = audio;
    this.lastBeep = null;
    this.wasStar = false;
    this.socket = socket;
    this.meId = meId;
    this.isTouch = isTouch;
    this.onOver = onOver;
    this.laps = state.laps;
    this.phase = state.phase;
    this.startAt = state.startAt;
    this.offset = null;
    this.players = new Map();
    this.finished = false;
    this.myRank = null;
    this.myTime = null;
    this.item = null;
    this.bananas = [];
    this.boxAvail = state.boxes.map(() => true);
    this.boxCooldown = state.boxes.map(() => 0);
    this.myShells = [];
    this.remoteShells = [];
    this.lastSend = 0;
    this.lastHud = 0;
    this.lastMini = 0;
    this.msgs = [];
    this.destroyed = false;
    this.autoGas = isTouch;
    this.input = { steer: 0, gas: 0, brake: false, left: false, right: false, gasBtn: false };
    this.eff = { spinUntil: 0, boostUntil: 0, starUntil: 0, slowUntil: 0 };
    this.showStandings = !isTouch;

    // 建立所有車
    for (const p of state.players) {
      const k = scene.addKart(p, p.id === meId);
      const g = scene.gridPose(p.seat);
      k.x = g.x; k.y = g.y; k.z = g.z; k.rot = g.rot; k.speed = 0; k.stamp = performance.now();
      k.dispX = g.x; k.dispY = g.y; k.dispZ = g.z; k.dispRot = g.rot;
      scene.poseKart(k, g.x, g.y, g.z, g.rot);
      this.players.set(p.id, { ...p });
    }
    const me = state.players.find((p) => p.id === meId);
    this.kartDef = DEFS.KARTS.find((k) => k.id === me?.kart) || DEFS.KARTS[0];
    this.localKart = scene.karts.get(meId);
    const g = scene.gridPose(me?.seat ?? 0);
    this.local = { pos: new THREE.Vector3(g.x, g.y, g.z), rot: g.rot, speed: 0, steer: 0, hint: -1, t: 0, spinYaw: 0, wall: false };
    scene.camera.position.set(g.x - Math.sin(g.rot) * 10, g.y + 5, g.z - Math.cos(g.rot) * 10);
    scene.camTarget.set(g.x, g.y, g.z);

    this.bindInput();
    this.buildMinimap();
    this.renderHelp();
    $('#hud-standings').classList.toggle('collapsed', !this.showStandings);
    $('#touch-controls').classList.toggle('hidden', !isTouch);
    $('#hud-keys').classList.toggle('hidden', isTouch);
    this.updateAutoBtn();
    this.center('準備…');
    scene.onFrame = (dt) => this.update(dt);
    this.onSnapshot(state);
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
      const map = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'gas', w: 'gas', W: 'gas', ArrowDown: 'brake', s: 'brake', S: 'brake' };
      if (map[k]) {
        e.preventDefault();
        if (e.type === 'keydown') down.add(map[k]);
        else down.delete(map[k]);
        this.input.left = down.has('left');
        this.input.right = down.has('right');
        this.input.gasBtn = down.has('gas');
        this.input.brake = down.has('brake');
      } else if ((k === ' ' || k === 'Shift' || k === 'Enter') && e.type === 'keydown') {
        e.preventDefault();
        this.useItem();
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
    $('#tc-item').onclick = () => this.useItem();
    $('#hud-item').onclick = () => this.useItem();
    $('#tc-auto').onclick = () => {
      this.autoGas = !this.autoGas;
      this.updateAutoBtn();
    };
    $('#btn-standings').onclick = () => {
      this.showStandings = !this.showStandings;
      $('#hud-standings').classList.toggle('collapsed', !this.showStandings);
    };
  }

  updateAutoBtn() {
    $('#tc-auto').textContent = `自動油門：${this.autoGas ? '開' : '關'}`;
    $('#tc-gas').classList.toggle('hidden', this.autoGas);
  }

  useItem() {
    if (!this.item || this.phase !== 'racing' || this.finished) return;
    const L = this.local;
    const fwd = { x: Math.sin(L.rot), z: Math.cos(L.rot) };
    const payload = { x: L.pos.x - fwd.x * 3.5, y: L.pos.y, z: L.pos.z - fwd.z * 3.5 };
    const item = this.item;
    this.item = null;
    this.socket.emit('race:use', payload, (res) => {
      if (res?.error) {
        this.item = item;
        this.flash(res.error);
      }
    });
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
    const nowP = performance.now();
    for (const p of snap.players) {
      this.players.set(p.id, p);
      const k = this.scene.karts.get(p.id);
      if (!k) continue;
      k.spinUntil = p.spinUntil;
      k.starOn = p.starUntil > this.serverNow();
      k.dropped = p.dropped;
      if (p.dropped) k.group.visible = false;
      if (p.id === this.meId) {
        this.item = p.item;
        this.eff.spinUntil = Math.max(this.eff.spinUntil, p.spinUntil);
        this.eff.boostUntil = p.boostUntil;
        this.eff.starUntil = p.starUntil;
        this.eff.slowUntil = p.slowUntil;
        if (p.finished && !this.finished) {
          this.finished = true;
          this.myRank = p.rank;
          this.myTime = p.finishTime;
          this.center(`🏁 完賽！第 ${p.rank} 名<br><small>${fmtTime(p.finishTime)}</small>`, 0);
        }
        continue;
      }
      if (p.stampT !== undefined) continue;
      k.x = p.x; k.y = p.y; k.z = p.z; k.rot = p.rot; k.speed = p.speed; k.stamp = nowP;
    }
    this.bananas = snap.bananas;
    this.scene.syncBananas(snap.bananas);
    this.remoteShells = snap.shells.filter((s) => s.owner !== this.meId);
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
    switch (ev.type) {
      case 'go':
        this.phase = 'racing';
        this.center('GO!', 900);
        this.vibrate(60);
        this.audio?.countdownBeep(0);
        this.audio?.say('開始！', { priority: true });
        break;
      case 'item':
        if (ev.playerId === this.meId) {
          this.item = ev.item;
          this.flash(`拿到 ${I[ev.item].emoji} ${I[ev.item].name}`);
          this.audio?.itemGet();
          this.audio?.say(`拿到${I[ev.item].name}`);
        }
        break;
      case 'use':
        if (ev.playerId === this.meId) {
          if (ev.shellId) this.fireShell(ev.shellId, ev.kind, ev.targetId);
          this.audio?.useItem(ev.item);
        } else {
          if (ev.item !== 'star') this.audio?.click();
          this.flash(`${name(ev.playerId)} 使用了 ${I[ev.item].emoji} ${I[ev.item].name}`);
        }
        if (ev.item === 'lightning' && ev.victims?.includes(this.meId)) {
          this.eff.spinUntil = this.serverNow() + D.spinMs;
          this.center('⚡ 被閃電打中！', 1200);
          this.vibrate(150);
          this.audio?.hit();
          this.audio?.say('被閃電打中了！');
        }
        break;
      case 'hit':
        if (ev.playerId === this.meId) {
          this.eff.spinUntil = Math.max(this.eff.spinUntil, this.serverNow() + D.spinMs);
          const what = ev.kind === 'banana' ? '🍌 踩到香蕉' : `${I[ev.item]?.emoji ?? '💥'} 被 ${name(ev.by)} 打中`;
          this.center(what, 1200);
          this.vibrate(150);
          this.audio?.hit();
          this.audio?.say(ev.kind === 'banana' ? '踩到香蕉了！' : '被打中了！');
        } else {
          this.flash(`${name(ev.playerId)} ${ev.kind === 'banana' ? '踩到香蕉' : '被擊中'}`);
        }
        break;
      case 'lap':
        if (ev.playerId === this.meId) {
          const last = ev.lap === this.laps - 1;
          this.center(last ? '最後一圈！' : `第 ${ev.lap + 1} 圈`, 1500);
          this.vibrate(40);
          this.audio?.lap();
          this.audio?.say(last ? '最後一圈！' : `第${ev.lap + 1}圈`);
        }
        break;
      case 'finish':
        this.flash(`🏁 ${ev.name} 完賽，第 ${ev.rank} 名（${fmtTime(ev.time)}）`);
        if (ev.playerId === this.meId) {
          this.audio?.finish(ev.rank);
          this.audio?.say(ev.rank === 1 ? '恭喜！第一名完賽！' : `完賽，第${ev.rank}名`, { priority: true });
        } else this.audio?.click();
        break;
      case 'leave':
        this.flash(`${ev.name} 離開了比賽`);
        this.scene.removeKart(ev.playerId);
        break;
      case 'box':
        if (ev.playerId !== this.meId) this.boxAvail[ev.index] = false;
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

  /* ---------- 龜殼（由發射者模擬） ---------- */
  fireShell(id, kind, targetId) {
    const L = this.local;
    const dir = new THREE.Vector3(Math.sin(L.rot), 0, Math.cos(L.rot));
    const pos = L.pos.clone().add(dir.clone().multiplyScalar(3.5));
    this.myShells.push({ id, kind, pos, dir, speed: 52, born: performance.now(), hint: L.hint, targetId });
  }

  updateShells(dt) {
    const nowP = performance.now();
    for (let i = this.myShells.length - 1; i >= 0; i--) {
      const s = this.myShells[i];
      if (nowP - s.born > 8000) {
        this.myShells.splice(i, 1);
        continue;
      }
      if (s.kind === 'red') {
        const tk = s.targetId ? this.scene.karts.get(s.targetId) : null;
        if (tk && !tk.dropped) {
          const want = new THREE.Vector3(tk.dispX - s.pos.x, 0, tk.dispZ - s.pos.z).normalize();
          const ang = Math.atan2(s.dir.x, s.dir.z);
          const wantAng = Math.atan2(want.x, want.z);
          const na = lerpAngle(ang, wantAng, Math.min(1, 5 * dt));
          s.dir.set(Math.sin(na), 0, Math.cos(na));
        }
      }
      s.pos.addScaledVector(s.dir, s.speed * dt);
      const c = this.scene.closest(s.pos, s.hint);
      s.hint = c.idx;
      if (Math.abs(c.lateral) > this.scene.half) {
        const sign = Math.sign(c.lateral);
        s.pos.x = c.center.x + c.right.x * sign * this.scene.half;
        s.pos.z = c.center.z + c.right.z * sign * this.scene.half;
        const dot = s.dir.x * c.right.x + s.dir.z * c.right.z;
        s.dir.x -= 2 * dot * c.right.x;
        s.dir.z -= 2 * dot * c.right.z;
        s.dir.normalize();
      }
      s.pos.y = c.center.y;
      // 命中判定
      let hit = false;
      for (const [, k] of this.scene.karts) {
        if (k.isLocal || k.dropped) continue;
        const dx = k.dispX - s.pos.x;
        const dz = k.dispZ - s.pos.z;
        if (dx * dx + dz * dz < 2.4 * 2.4) {
          this.socket.emit('race:hit', { kind: 'shell', targetId: k.id, item: s.kind }, () => {});
          hit = true;
          break;
        }
      }
      if (hit) this.myShells.splice(i, 1);
    }
  }

  /* ---------- 每幀 ---------- */
  update(dt) {
    if (this.destroyed) return;
    const now = this.serverNow();
    const L = this.local;
    const eff = this.eff;
    const spinning = now < eff.spinUntil;
    const boost = now < eff.boostUntil;
    const star = now < eff.starUntil;
    const slow = now < eff.slowUntil;
    const racing = this.phase === 'racing' && !this.finished;
    const kart = this.kartDef;

    // 輸入整合
    const inp = this.input;
    inp.steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    inp.gas = inp.gasBtn || (this.autoGas && this.isTouch && !inp.brake) ? 1 : 0;

    const c0 = this.scene.closest(L.pos, L.hint);
    L.hint = c0.idx;
    const offroad = Math.abs(c0.lateral) > this.scene.half - 1.3;

    if (spinning) {
      L.speed = THREE.MathUtils.damp(L.speed, 0, 4, dt);
      L.spinYaw += dt * ((Math.PI * 4) / (D.spinMs / 1000));
    } else {
      L.spinYaw = 0;
      let maxSpeed = kart.maxSpeed * (boost ? 1.55 : 1) * (star ? 1.25 : 1) * (slow ? 0.6 : 1);
      if (offroad && !boost && !star) maxSpeed *= kart.offroad;
      const accel = kart.accel * (boost ? 2.5 : 1);
      if (racing && inp.gas > 0) L.speed += accel * inp.gas * dt;
      else L.speed = THREE.MathUtils.damp(L.speed, 0, racing ? 0.7 : 2.5, dt);
      if (racing && inp.brake) L.speed -= accel * 1.7 * dt;
      if (L.speed > maxSpeed) L.speed = THREE.MathUtils.damp(L.speed, maxSpeed, 5, dt);
      const minSpeed = -maxSpeed * 0.35;
      if (L.speed < minSpeed) L.speed = minSpeed;
      L.steer = THREE.MathUtils.damp(L.steer, racing ? inp.steer : 0, 14, dt);
      const grip = Math.min(1, Math.abs(L.speed) / 9);
      L.rot -= kart.turn * L.steer * grip * dt * (L.speed < 0 ? -1 : 1);
    }

    L.pos.x += Math.sin(L.rot) * L.speed * dt;
    L.pos.z += Math.cos(L.rot) * L.speed * dt;

    // 護欄
    const c = this.scene.closest(L.pos, L.hint);
    L.hint = c.idx;
    const limit = this.scene.half - 0.2;
    if (Math.abs(c.lateral) > limit) {
      const sign = Math.sign(c.lateral);
      L.pos.x = c.center.x + c.right.x * sign * limit;
      L.pos.z = c.center.z + c.right.z * sign * limit;
      if (!L.wall) {
        L.speed *= 0.55;
        L.wall = true;
        this.vibrate(30);
        this.audio?.wall();
      }
      const tangYaw = Math.atan2(c.tangent.x, c.tangent.z);
      L.rot = lerpAngle(L.rot, tangYaw, Math.min(1, 4 * dt));
    } else {
      L.wall = false;
    }
    L.pos.y = c.center.y;
    L.t = c.t;

    // 車與車碰撞（本地推開）
    for (const [, k] of this.scene.karts) {
      if (k.isLocal || k.dropped) continue;
      const dx = L.pos.x - k.dispX;
      const dz = L.pos.z - k.dispZ;
      const d = Math.hypot(dx, dz);
      if (d < 3.0 && d > 0.001) {
        const push = 3.0 - d;
        L.pos.x += (dx / d) * push * 0.7;
        L.pos.z += (dz / d) * push * 0.7;
        if (!star && !k.pushed) {
          L.speed *= k.heavy && !kart.heavy ? 0.45 : 0.8;
          k.pushed = true;
          this.audio?.bump();
        }
      } else {
        k.pushed = false;
      }
    }

    // 香蕉
    if (racing && !star && !spinning) {
      for (const b of this.bananas) {
        const dx = L.pos.x - b.x;
        const dz = L.pos.z - b.z;
        if (dx * dx + dz * dz < 2.0 * 2.0) {
          eff.spinUntil = now + D.spinMs;
          this.bananas = this.bananas.filter((x) => x.id !== b.id);
          this.socket.emit('race:hit', { kind: 'banana', bananaId: b.id, targetId: this.meId }, () => {});
          break;
        }
      }
    }

    // 道具箱
    if (racing) {
      this.scene.boxPositions.forEach((bp, i) => {
        if (!this.boxAvail[i]) return;
        const dx = L.pos.x - bp.x;
        const dz = L.pos.z - bp.z;
        if (dx * dx + dz * dz < 2.6 * 2.6) {
          this.boxAvail[i] = false;
          this.boxCooldown[i] = now + DEFS.ITEM_BOX_RESPAWN_MS;
          this.scene.setBoxes(this.boxAvail);
          this.audio?.pickup();
          this.socket.emit('race:pickup', { box: i }, () => {});
        }
      });
    }

    this.updateShells(dt);

    // 本地車姿態
    const lk = this.localKart;
    if (lk) {
      lk.speed = L.speed;
      lk.starOn = star;
      this.scene.poseKart(lk, L.pos.x, L.pos.y, L.pos.z, L.rot, L.spinYaw);
    }

    // 遠端車：預測 + 平滑
    const nowP = performance.now();
    for (const [, k] of this.scene.karts) {
      if (k.isLocal || k.dropped) continue;
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
      this.scene.poseKart(k, nx, ny, nz, nrot, k.spinPhase);
    }

    this.scene.syncShells([
      ...this.myShells.map((s) => ({ id: s.id, kind: s.kind, x: s.pos.x, y: s.pos.y, z: s.pos.z, owned: true })),
      ...this.remoteShells,
    ]);
    this.scene.chase(lk, dt, this.finished);
    this.audio?.engineUpdate(Math.min(1, Math.abs(L.speed) / kart.maxSpeed), racing ? inp.gas : 0, boost);

    // 網路：每 50ms 回報
    if (nowP - this.lastSend > 50) {
      this.lastSend = nowP;
      this.socket.volatile.emit('race:state', {
        x: L.pos.x, y: L.pos.y, z: L.pos.z, rot: L.rot, speed: L.speed, t: L.t,
        shells: this.myShells.map((s) => ({ id: s.id, kind: s.kind, x: s.pos.x, y: s.pos.y, z: s.pos.z })),
      });
    }
    if (nowP - this.lastHud > 100) {
      this.lastHud = nowP;
      this.renderHud(now);
    }
    if (nowP - this.lastMini > 120) {
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
    $('#hud-lap').textContent = `第 ${lapNow} / ${this.laps} 圈`;
    const standing = me?.standing ?? 1;
    $('#hud-pos').textContent = `第 ${standing} 名`;
    $('#hud-speed').textContent = `${Math.round(Math.abs(this.local.speed) * 2.6)} km/h`;
    const slot = $('#hud-item');
    const tcItem = $('#tc-item');
    const nameEl = $('#hud-item-name');
    if (this.item) {
      const it = DEFS.ITEMS[this.item];
      slot.textContent = it.emoji;
      slot.classList.add('usable');
      slot.title = `${it.name}：${it.desc}`;
      tcItem.textContent = it.emoji;
      tcItem.classList.add('usable');
      nameEl.textContent = `${it.name}｜${it.desc}`;
      nameEl.classList.remove('hidden');
    } else {
      slot.textContent = '·';
      slot.classList.remove('usable');
      slot.title = '沒有道具';
      tcItem.textContent = '🎁';
      tcItem.classList.remove('usable');
      nameEl.classList.add('hidden');
    }
    // 倒數
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
    const starNow = now < this.eff.starUntil;
    if (starNow !== this.wasStar) {
      this.wasStar = starNow;
      if (starNow) this.audio?.starStart();
      else this.audio?.starStop();
    }
    // 排名列表
    const list = (this.snapPlayers || []).filter((p) => !p.dropped).sort((a, b) => a.standing - b.standing);
    $('#hud-standings').innerHTML = list
      .map((p) => {
        const ch = DEFS.CHARACTERS.find((c) => c.id === p.character);
        const status = p.finished ? `🏁 ${fmtTime(p.finishTime)}` : `第 ${Math.min(this.laps, p.lap + 1)} 圈`;
        const item = p.item ? DEFS.ITEMS[p.item]?.emoji : '';
        return `<div class="st-row${p.id === this.meId ? ' me' : ''}"><span class="rank">${p.standing}</span><span class="dot" style="background:${ch?.color}"></span><span class="name">${esc(p.name)}</span><span class="it">${item}</span><span class="sub">${status}</span></div>`;
      })
      .join('');
    this.renderMsgs();
    // 特效提示
    const badges = [];
    if (now < this.eff.starUntil) badges.push('⭐ 無敵');
    if (now < this.eff.boostUntil) badges.push('🍄 加速');
    if (now < this.eff.slowUntil) badges.push('⚡ 減速');
    $('#hud-fx').textContent = badges.join(' ');
  }

  /* ---------- 小地圖 ---------- */
  buildMinimap() {
    const cv = $('#minimap');
    const pts = this.scene.samples.filter((_, i) => i % 6 === 0).map((s) => [s.pos.x, s.pos.z]);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const pad = 14;
    const sc = Math.min((cv.width - pad * 2) / (maxX - minX), (cv.height - pad * 2) / (maxZ - minZ));
    this.mini = { cv, pts, sc, minX, minZ, pad, ox: (cv.width - (maxX - minX) * sc) / 2, oz: (cv.height - (maxZ - minZ) * sc) / 2 };
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
      .map((t) => `<div class="legend"><div class="e">${t.emoji}</div><div><b>${esc(t.name)}</b>${esc(t.desc)}</div></div>`)
      .join('');
    $('#help-karts').innerHTML = DEFS.KARTS.map((k) => `<div class="legend"><div class="e">${k.emoji}</div><div><b>${esc(k.name)}</b>${esc(k.desc)}</div></div>`).join('');
  }

  destroy() {
    this.destroyed = true;
    this.audio?.engineStop();
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
