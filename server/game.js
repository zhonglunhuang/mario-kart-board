'use strict';
/* 即時競速的伺服器端狀態：倒數、圈數/檢查點、排名、道具、命中、完賽、AI 車手席位。
 * 車輛物理由各客戶端自己模擬並回報位置（AI 車由房主的客戶端模擬）；伺服器負責裁判與同步。 */
const DEFS = require('../public/shared/defs.js');
const log = require('./log.js');

const D = DEFS.DURATIONS;
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
   * @param {Array<{id,name,character,kart,bot?}>} roster
   * @param {{laps, map, variant, difficulty, hostId, emit, onOver}} opts
   */
  constructor(roster, opts) {
    this.map = DEFS.MAPS[opts.map] ? opts.map : DEFS.DEFAULT_MAP;
    const M = DEFS.MAPS[this.map];
    this.checkpoints = M.checkpoints;
    this.laps = Math.min(9, Math.max(1, opts.laps || 3));
    this.variant = { reverse: !!opts.variant?.reverse, mirror: !!opts.variant?.mirror, time: opts.variant?.time || 'day', weather: opts.variant?.weather || 'clear' };
    this.difficulty = opts.difficulty || 'normal';
    this.hostId = opts.hostId;
    this.emit = opts.emit;
    this.onOver = opts.onOver;
    this.players = new Map();
    roster.forEach((p, i) => {
      this.players.set(p.id, {
        id: p.id, name: p.name, character: p.character, kart: p.kart, bot: !!p.bot, seat: i,
        x: 0, y: 0, z: 0, rot: 0, speed: 0, airborne: false, drift: 0, trailing: false,
        t: 0, prevT: 0, lap: 0, checkpoint: 0,
        item: null, // { id, count }
        spinUntil: 0, boostUntil: 0, starUntil: 0, slowUntil: 0, goldenUntil: 0,
        finished: false, rank: null, finishTime: null, dropped: false,
        shells: [], bombs: [],
        lastSeen: now(), reported: false,
      });
    });
    this.bananas = new Map();
    this.boxes = M.itemBoxes.map(() => 0);
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
  humans() {
    return this.active().filter((p) => !p.bot);
  }

  /** 是否允許 senderId 代表 id 行動（本人，或房主代表 AI 車） */
  actorFor(senderId, asId) {
    const id = asId || senderId;
    const p = this.get(id);
    if (!p || p.dropped) return null;
    if (id === senderId) return p;
    if (p.bot && senderId === this.hostId) return p;
    return null;
  }

  setHost(id) {
    this.hostId = id;
    this.emit('race:event', { type: 'host', hostId: id });
  }

  ranking() {
    const done = this.active().filter((p) => p.finished).sort((a, b) => a.rank - b.rank);
    const running = this.racing().sort((a, b) => b.lap + b.t - (a.lap + a.t));
    return [...done, ...running];
  }

  /* ---------- 客戶端回報 ---------- */
  updateState(senderId, s, asId) {
    const p = this.actorFor(senderId, asId);
    if (!p) return;
    p.lastSeen = now();
    p.reported = true;
    const num = (v, def = 0) => (Number.isFinite(v) ? v : def);
    p.x = num(s.x); p.y = num(s.y); p.z = num(s.z); p.rot = num(s.rot); p.speed = num(s.speed);
    p.airborne = !!s.air;
    p.drift = Math.max(0, Math.min(3, num(s.drift) | 0));
    p.trailing = !!s.trail && !!p.item && !!DEFS.ITEMS[p.item.id]?.trail;
    p.shells = Array.isArray(s.shells)
      ? s.shells.slice(0, 6).map((sh) => ({ id: String(sh.id).slice(0, 16), kind: ['red', 'blue'].includes(sh.kind) ? sh.kind : 'green', x: num(sh.x), y: num(sh.y), z: num(sh.z) }))
      : [];
    p.bombs = Array.isArray(s.bombs) ? s.bombs.slice(0, 3).map((b) => ({ id: String(b.id).slice(0, 16), x: num(b.x), y: num(b.y), z: num(b.z) })) : [];
    if (this.phase !== 'racing' || p.finished) return;

    const t = Math.min(0.999999, Math.max(0, num(s.t)));
    const prev = p.t;
    p.prevT = prev;
    p.t = t;
    const cp = this.checkpoints;
    if (p.checkpoint < cp.length && prev < cp[p.checkpoint] && t >= cp[p.checkpoint] && t - prev < 0.3) p.checkpoint++;
    if (prev > 0.8 && t < 0.2) {
      if (p.checkpoint >= cp.length) {
        p.lap++;
        p.checkpoint = 0;
        if (p.lap >= this.laps) this.finish(p);
        else this.emit('race:event', { type: 'lap', playerId: p.id, lap: p.lap });
      }
    } else if (prev < 0.2 && t > 0.8 && p.lap > 0) {
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
    // 沒有真人在跑了就結束（AI 不用等）
    if (this.active().length === 0) this.over('no-players');
    else if (this.racing().filter((p) => !p.bot).length === 0) this.over('all-humans-finished');
  }

  over(reason = 'unknown') {
    if (this.finished) return;
    this.finished = true;
    this.phase = 'over';
    this.overReason = reason;
    log.info('race over', { map: this.map, reason, players: this.active().map((p) => `${p.name}${p.bot ? '(AI)' : ''}:${p.finished ? p.rank : 'dnf'}`) });
    for (const p of this.racing()) {
      p.finished = true;
      p.rank = this.finishOrder.length + 1;
      this.finishOrder.push(p.id);
    }
    clearInterval(this.timer);
    this.onOver();
  }

  /* ---------- 道具 ---------- */
  pickup(senderId, boxIndex, asId) {
    const p = this.actorFor(senderId, asId);
    if (!p || p.finished || this.phase !== 'racing') return { error: '無法撿取' };
    const i = parseInt(boxIndex, 10);
    if (!(i >= 0 && i < this.boxes.length)) return { error: '道具箱不存在' };
    if (this.boxes[i] > now()) return { error: '道具箱尚未重生' };
    this.boxes[i] = now() + DEFS.ITEM_BOX_RESPAWN_MS;
    this.emit('race:event', { type: 'box', index: i, playerId: p.id });
    if (p.item) return { ok: true, item: p.item };
    const n = this.active().length;
    const rank = this.ranking().indexOf(p) + 1;
    const k = n <= 1 ? 0 : (rank - 1) / (n - 1); // 0 = 領先, 1 = 最後
    const id = weightedPick({
      mushroom: 3 + k * 2,
      banana: 3 * (1 - k) + 0.5,
      tripleBanana: 1.2 * (1 - k),
      green: 3 * (1 - k) + 1,
      tripleGreen: 1.5 * (1 - k) + 0.3,
      red: 1.5 + k * 2.5,
      tripleRed: k * 2,
      blue: n > 1 && rank > 1 ? k * k * 2.2 : 0,
      bomb: 1 + k,
      golden: k * 2.5,
      lightning: k * 3,
      star: k * 2.5,
    });
    p.item = { id, count: DEFS.ITEMS[id].count || 1 };
    this.emit('race:event', { type: 'item', playerId: p.id, item: p.item });
    return { ok: true, item: p.item };
  }

  useItem(senderId, payload = {}, asId) {
    const p = this.actorFor(senderId, asId);
    if (!p || p.finished || this.phase !== 'racing') return { error: '現在不能使用道具' };
    if (!p.item) return { error: '沒有道具' };
    const def = DEFS.ITEMS[p.item.id];
    const item = def.uses || p.item.id;
    p.item.count -= 1;
    if (p.item.count <= 0) p.item = null;
    const t = now();
    const num = (v) => (Number.isFinite(v) ? v : 0);
    const dir = payload.dir === -1 ? -1 : 1;
    const ev = { type: 'use', playerId: p.id, item, name: p.name, dir, remaining: p.item ? p.item.count : 0 };
    switch (item) {
      case 'mushroom':
        p.boostUntil = t + D.boostMs;
        break;
      case 'golden':
        p.goldenUntil = t + D.goldenMs;
        break;
      case 'star':
        p.starUntil = t + D.starMs;
        break;
      case 'banana': {
        const bid = `b${this.nextId++}`;
        this.bananas.set(bid, { id: bid, owner: p.id, x: num(payload.x), y: num(payload.y), z: num(payload.z) });
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
      case 'red':
      case 'blue':
      case 'bomb': {
        ev.shellId = `s${this.nextId++}`;
        ev.kind = item;
        if (item === 'red') {
          const list = this.racing().filter((o) => o !== p);
          const ahead = list.filter((o) => (dir > 0 ? o.lap + o.t > p.lap + p.t : o.lap + o.t < p.lap + p.t)).sort((a, b) => (dir > 0 ? a.lap + a.t - (b.lap + b.t) : b.lap + b.t - (a.lap + a.t)));
          ev.targetId = ahead[0]?.id || null;
        } else if (item === 'blue') {
          const leader = this.ranking().filter((o) => !o.finished && o !== p)[0];
          ev.targetId = leader?.id || null;
        }
        break;
      }
      default:
        break;
    }
    this.emit('race:event', ev);
    return { ok: true, shellId: ev.shellId, targetId: ev.targetId, remaining: ev.remaining };
  }

  /** 命中回報：{kind:'shell'|'banana'|'bomb', targetId | targets:[], bananaId, item} */
  hit(senderId, payload = {}) {
    const reporter = this.get(senderId);
    if (!reporter || reporter.dropped || this.phase !== 'racing') return { error: '無效' };
    const t = now();
    const kind = payload.kind;
    const targets = Array.isArray(payload.targets) ? payload.targets : [payload.targetId];
    const results = [];
    let bananaGone = false;
    if (kind === 'banana') {
      const b = this.bananas.get(String(payload.bananaId || ''));
      if (!b) return { error: '香蕉不存在' };
      this.bananas.delete(b.id);
      bananaGone = true;
      this.emit('race:event', { type: 'bananaGone', bananaId: b.id });
    } else if (!['shell', 'bomb'].includes(kind)) {
      return { error: '未知的命中類型' };
    }
    for (const tid of targets) {
      const target = this.get(String(tid || ''));
      if (!target || target.dropped || target.finished) continue;
      // 只能回報自己 / 自己的 AI 車踩到香蕉
      if (kind === 'banana' && !this.actorFor(senderId, target.id)) continue;
      if (target.starUntil > t) {
        results.push({ id: target.id, immune: true });
        continue;
      }
      // 拖在車後的道具可以擋一次龜殼
      if (kind === 'shell' && target.trailing && target.item && DEFS.ITEMS[target.item.id]?.trail) {
        target.item.count -= 1;
        if (target.item.count <= 0) target.item = null;
        target.trailing = false;
        this.emit('race:event', { type: 'blocked', playerId: target.id, by: senderId, item: target.item });
        results.push({ id: target.id, blocked: true });
        continue;
      }
      if (target.spinUntil > t) {
        results.push({ id: target.id, already: true });
        continue;
      }
      target.spinUntil = t + D.spinMs * (kind === 'bomb' ? 1.3 : 1);
      this.emit('race:event', { type: 'hit', playerId: target.id, by: payload.by && this.actorFor(senderId, payload.by) ? payload.by : senderId, kind, item: payload.item || null });
      results.push({ id: target.id, hit: true });
    }
    return { ok: true, results, bananaGone };
  }

  removePlayer(id) {
    const p = this.get(id);
    if (!p || p.dropped) return;
    p.dropped = true;
    p.shells = [];
    p.bombs = [];
    this.emit('race:event', { type: 'leave', playerId: id, name: p.name });
    this.checkOver();
  }

  tick() {
    const t = now();
    if (this.phase === 'countdown' && t >= this.startAt) {
      this.phase = 'racing';
      this.emit('race:event', { type: 'go' });
    }
    if (this.phase === 'racing' && this.firstFinishAt && t - this.firstFinishAt > D.finishGraceMs) {
      this.over('grace-timeout');
      return;
    }
    for (const p of this.active()) {
      if (p.bot) continue;
      // 還在載入場景（尚未回報過）的玩家不算掉線；socket 斷線另有處理
      if (p.reported && t - p.lastSeen > 30000 && this.phase === 'racing') {
        log.warn('player inactive, removed from race', { id: p.id, name: p.name, silentMs: t - p.lastSeen });
        this.removePlayer(p.id);
      }
    }
    if (this.finished) return;
    this.emit('race:snapshot', this.snapshot());
  }

  snapshot() {
    const t = now();
    const ranking = this.ranking();
    const shells = [];
    const bombs = [];
    const players = [...this.players.values()].map((p) => {
      for (const s of p.shells) shells.push({ ...s, owner: p.id });
      for (const b of p.bombs) bombs.push({ ...b, owner: p.id });
      return {
        id: p.id, name: p.name, character: p.character, kart: p.kart, seat: p.seat, bot: p.bot,
        x: p.x, y: p.y, z: p.z, rot: p.rot, speed: p.speed, air: p.airborne, drift: p.drift, trailing: p.trailing,
        t: p.t, lap: p.lap, rank: p.rank, standing: ranking.indexOf(p) + 1,
        item: p.item, spinUntil: p.spinUntil, boostUntil: p.boostUntil, starUntil: p.starUntil, slowUntil: p.slowUntil, goldenUntil: p.goldenUntil,
        finished: p.finished, finishTime: p.finishTime, dropped: p.dropped,
      };
    });
    return {
      now: t,
      map: this.map,
      variant: this.variant,
      difficulty: this.difficulty,
      hostId: this.hostId,
      phase: this.phase,
      startAt: this.startAt,
      laps: this.laps,
      players,
      shells,
      bombs,
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

module.exports = { Race };
