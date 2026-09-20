'use strict';
/* 即時競速的伺服器端狀態：倒數、圈數/檢查點、排名、道具、命中、完賽。
 * 車輛物理由各客戶端自己模擬並回報位置；伺服器負責裁判與同步。 */
const DEFS = require('../public/shared/defs.js');

const D = DEFS.DURATIONS;
const ITEM_IDS = Object.keys(DEFS.ITEMS);
const TICK_MS = 50;
const now = () => Date.now();

function weightedPick(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

class Race {
  /**
   * @param {Array<{id,name,character,kart}>} roster
   * @param {{laps:number, emit:(event:string,payload:any)=>void, onOver:()=>void}} opts
   */
  constructor(roster, opts) {
    this.map = DEFS.MAPS[opts.map] ? opts.map : DEFS.DEFAULT_MAP;
    const M = DEFS.MAPS[this.map];
    this.checkpoints = M.checkpoints;
    this.laps = Math.min(9, Math.max(1, opts.laps || 3));
    this.emit = opts.emit;
    this.onOver = opts.onOver;
    this.players = new Map();
    roster.forEach((p, i) => {
      this.players.set(p.id, {
        id: p.id,
        name: p.name,
        character: p.character,
        kart: p.kart,
        seat: i,
        x: 0, y: 0, z: 0, rot: 0, speed: 0,
        t: 0, prevT: 0, lap: 0, checkpoint: 0,
        item: null,
        spinUntil: 0, boostUntil: 0, starUntil: 0, slowUntil: 0,
        finished: false, rank: null, finishTime: null, dropped: false,
        shells: [],
        lastSeen: now(),
      });
    });
    this.bananas = new Map();
    this.boxes = M.itemBoxes.map(() => 0); // 0 = 可撿；否則為重生時間
    this.nextId = 1;
    this.phase = 'countdown';
    this.startAt = now() + D.countdownMs;
    this.finishOrder = [];
    this.firstFinishAt = null;
    this.finished = false;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  destroy() {
    clearInterval(this.timer);
  }

  get(id) {
    return this.players.get(id);
  }

  active() {
    return [...this.players.values()].filter((p) => !p.dropped);
  }

  racing() {
    return this.active().filter((p) => !p.finished);
  }

  /* ---------- 排名 ---------- */
  ranking() {
    const done = this.active().filter((p) => p.finished).sort((a, b) => a.rank - b.rank);
    const running = this.racing().sort((a, b) => b.lap + b.t - (a.lap + a.t));
    return [...done, ...running];
  }

  /* ---------- 客戶端回報 ---------- */
  updateState(id, s) {
    const p = this.get(id);
    if (!p || p.dropped) return;
    p.lastSeen = now();
    const num = (v, def = 0) => (Number.isFinite(v) ? v : def);
    p.x = num(s.x);
    p.y = num(s.y);
    p.z = num(s.z);
    p.rot = num(s.rot);
    p.speed = num(s.speed);
    if (Array.isArray(s.shells)) {
      p.shells = s.shells.slice(0, 4).map((sh) => ({ id: String(sh.id).slice(0, 16), kind: sh.kind === 'red' ? 'red' : 'green', x: num(sh.x), y: num(sh.y), z: num(sh.z) }));
    } else {
      p.shells = [];
    }
    if (this.phase !== 'racing' || p.finished) return;

    const t = Math.min(0.999999, Math.max(0, num(s.t)));
    const prev = p.t;
    p.prevT = prev;
    p.t = t;
    // 檢查點（依序經過 0.25 / 0.5 / 0.75）
    const cp = this.checkpoints;
    if (p.checkpoint < cp.length && prev < cp[p.checkpoint] && t >= cp[p.checkpoint] && t - prev < 0.3) {
      p.checkpoint++;
    }
    // 通過終點線（t 從接近 1 跳回接近 0）
    if (prev > 0.8 && t < 0.2) {
      if (p.checkpoint >= cp.length) {
        p.lap++;
        p.checkpoint = 0;
        if (p.lap >= this.laps) this.finish(p);
        else this.emit('race:event', { type: 'lap', playerId: id, lap: p.lap });
      }
    } else if (prev < 0.2 && t > 0.8 && p.lap > 0) {
      // 倒車越過終點線
      p.lap--;
      p.checkpoint = cp.length;
    }
  }

  finish(p) {
    p.finished = true;
    p.rank = this.finishOrder.length + 1;
    p.finishTime = now() - this.startAt;
    this.finishOrder.push(p.id);
    if (!this.firstFinishAt) this.firstFinishAt = now();
    this.emit('race:event', { type: 'finish', playerId: p.id, rank: p.rank, time: p.finishTime, name: p.name });
    this.checkOver();
  }

  checkOver() {
    if (this.finished) return;
    if (this.racing().length === 0 || this.active().length === 0) this.over();
  }

  over() {
    if (this.finished) return;
    this.finished = true;
    this.phase = 'over';
    for (const p of this.racing()) {
      p.finished = true;
      p.rank = this.finishOrder.length + 1;
      this.finishOrder.push(p.id);
    }
    clearInterval(this.timer);
    this.onOver();
  }

  /* ---------- 道具 ---------- */
  pickup(id, boxIndex) {
    const p = this.get(id);
    if (!p || p.dropped || p.finished || this.phase !== 'racing') return { error: '無法撿取' };
    const i = parseInt(boxIndex, 10);
    if (!(i >= 0 && i < this.boxes.length)) return { error: '道具箱不存在' };
    if (this.boxes[i] > now()) return { error: '道具箱尚未重生' };
    this.boxes[i] = now() + DEFS.ITEM_BOX_RESPAWN_MS;
    this.emit('race:event', { type: 'box', index: i, playerId: id });
    if (p.item) return { ok: true, item: p.item };
    const n = this.active().length;
    const rank = this.ranking().indexOf(p) + 1;
    const k = n <= 1 ? 0 : (rank - 1) / (n - 1); // 0 = 領先, 1 = 最後
    p.item = weightedPick({
      mushroom: 3 + k * 2,
      banana: 3 * (1 - k) + 0.5,
      green: 3 * (1 - k) + 1,
      red: 1.5 + k * 2.5,
      lightning: k * 3,
      star: k * 2.5,
    });
    this.emit('race:event', { type: 'item', playerId: id, item: p.item });
    return { ok: true, item: p.item };
  }

  useItem(id, payload = {}) {
    const p = this.get(id);
    if (!p || p.dropped || p.finished || this.phase !== 'racing') return { error: '現在不能使用道具' };
    if (!p.item) return { error: '沒有道具' };
    const item = p.item;
    p.item = null;
    const t = now();
    const num = (v) => (Number.isFinite(v) ? v : 0);
    const ev = { type: 'use', playerId: id, item, name: p.name };
    switch (item) {
      case 'mushroom':
        p.boostUntil = t + D.boostMs;
        break;
      case 'star':
        p.starUntil = t + D.starMs;
        break;
      case 'banana': {
        const bid = `b${this.nextId++}`;
        this.bananas.set(bid, { id: bid, owner: id, x: num(payload.x), y: num(payload.y), z: num(payload.z) });
        ev.bananaId = bid;
        break;
      }
      case 'lightning': {
        ev.victims = [];
        for (const o of this.racing()) {
          if (o === p || o.starUntil > t) continue;
          o.spinUntil = t + D.spinMs;
          o.slowUntil = t + D.slowMs;
          ev.victims.push(o.id);
        }
        break;
      }
      case 'green':
      case 'red': {
        // 龜殼由發射者的客戶端模擬並回報位置；伺服器只記錄發射事件
        ev.shellId = `s${this.nextId++}`;
        ev.kind = item;
        if (item === 'red') {
          const ahead = this.racing()
            .filter((o) => o !== p && o.lap + o.t > p.lap + p.t)
            .sort((a, b) => a.lap + a.t - (b.lap + b.t));
          ev.targetId = ahead[0]?.id || null;
        }
        break;
      }
      default:
        break;
    }
    this.emit('race:event', ev);
    return { ok: true, shellId: ev.shellId, targetId: ev.targetId };
  }

  /** 命中回報：kind = 'shell' | 'banana' | 'bump' ；由偵測到碰撞的客戶端回報 */
  hit(reporterId, payload = {}) {
    const reporter = this.get(reporterId);
    if (!reporter || reporter.dropped || this.phase !== 'racing') return { error: '無效' };
    const t = now();
    const target = this.get(String(payload.targetId || ''));
    if (!target || target.dropped || target.finished) return { error: '目標不存在' };
    if (payload.kind === 'banana') {
      const b = this.bananas.get(String(payload.bananaId || ''));
      if (!b) return { error: '香蕉不存在' };
      if (target.id !== reporterId) return { error: '只能回報自己踩到香蕉' };
      this.bananas.delete(b.id);
      this.emit('race:event', { type: 'bananaGone', bananaId: b.id });
      if (target.starUntil > t) return { ok: true, immune: true };
    } else if (payload.kind === 'shell') {
      if (target.starUntil > t) return { ok: true, immune: true };
    } else {
      return { error: '未知的命中類型' };
    }
    if (target.spinUntil > t) return { ok: true, already: true };
    target.spinUntil = t + D.spinMs;
    this.emit('race:event', { type: 'hit', playerId: target.id, by: reporterId, kind: payload.kind, item: payload.item || null });
    return { ok: true };
  }

  removePlayer(id) {
    const p = this.get(id);
    if (!p || p.dropped) return;
    p.dropped = true;
    p.shells = [];
    this.emit('race:event', { type: 'leave', playerId: id, name: p.name });
    this.checkOver();
  }

  /* ---------- 每 50ms ---------- */
  tick() {
    const t = now();
    if (this.phase === 'countdown' && t >= this.startAt) {
      this.phase = 'racing';
      this.emit('race:event', { type: 'go' });
    }
    if (this.phase === 'racing' && this.firstFinishAt && t - this.firstFinishAt > D.finishGraceMs) {
      this.over();
      return;
    }
    // 太久沒回報的玩家視為掉線（socket 斷線會另外處理，這裡是保險）
    for (const p of this.active()) if (t - p.lastSeen > 15000 && this.phase === 'racing') this.removePlayer(p.id);
    if (this.finished) return;
    this.emit('race:snapshot', this.snapshot());
  }

  snapshot() {
    const t = now();
    const ranking = this.ranking();
    const shells = [];
    const players = [...this.players.values()].map((p) => {
      for (const s of p.shells) shells.push({ ...s, owner: p.id });
      return {
        id: p.id, name: p.name, character: p.character, kart: p.kart, seat: p.seat,
        x: p.x, y: p.y, z: p.z, rot: p.rot, speed: p.speed,
        t: p.t, lap: p.lap, rank: p.rank, standing: ranking.indexOf(p) + 1,
        item: p.item, spinUntil: p.spinUntil, boostUntil: p.boostUntil, starUntil: p.starUntil, slowUntil: p.slowUntil,
        finished: p.finished, finishTime: p.finishTime, dropped: p.dropped,
      };
    });
    return {
      now: t,
      map: this.map,
      phase: this.phase,
      startAt: this.startAt,
      laps: this.laps,
      players,
      shells,
      bananas: [...this.bananas.values()],
      boxes: this.boxes.map((r) => r <= t),
      finishOrder: [...this.finishOrder],
    };
  }

  result() {
    const snap = this.snapshot();
    snap.players.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    return snap;
  }
}

module.exports = { Race, ITEM_IDS };
