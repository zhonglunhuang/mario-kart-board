'use strict';
const DEFS = require('../public/shared/defs.js');

const N = DEFS.TRACK_LENGTH;
const TILES = DEFS.TILES;
const ITEM_IDS = Object.keys(DEFS.ITEMS);

function rand(n) {
  return Math.floor(Math.random() * n);
}

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

class Game {
  /**
   * @param {Array<{id,name,character,kart}>} players
   * @param {{laps:number, turnSeconds:number, onTimeout:Function}} opts
   */
  constructor(players, opts) {
    this.laps = Math.min(5, Math.max(1, opts.laps || 2));
    this.turnSeconds = opts.turnSeconds || 45;
    this.onTimeout = opts.onTimeout || (() => {});
    this.finishPos = this.laps * N;
    this.players = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      character: p.character,
      kart: p.kart,
      seat: i,
      pos: 0,
      items: [],
      starTurns: 0,
      skipTurn: false,
      finished: false,
      rank: null,
      dropped: false,
    }));
    this.turnIndex = 0;
    this.turnNumber = 1;
    this.phase = 'await'; // await: 目前玩家可用道具 / 擲骰
    this.usedItemThisTurn = false;
    this.bananas = {}; // tile -> ownerId
    this.finishOrder = [];
    this.finished = false;
    this.turnDeadline = 0;
    this.timer = null;
    this.armTimer();
  }

  /* ---------- helpers ---------- */
  get current() {
    return this.players[this.turnIndex];
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id);
  }

  active() {
    return this.players.filter((p) => !p.finished && !p.dropped);
  }

  ranking() {
    const done = [...this.players].filter((p) => p.finished).sort((a, b) => a.rank - b.rank);
    const running = this.active().sort((a, b) => b.pos - a.pos);
    const dropped = this.players.filter((p) => p.dropped && !p.finished);
    return [...done, ...running, ...dropped];
  }

  rankOf(p) {
    return this.ranking().indexOf(p) + 1;
  }

  armTimer() {
    clearTimeout(this.timer);
    if (this.finished) return;
    this.turnDeadline = Date.now() + this.turnSeconds * 1000;
    this.timer = setTimeout(() => {
      if (this.finished) return;
      const p = this.current;
      const ev = this.roll(p.id, true);
      if (ev && !ev.error) this.onTimeout(ev);
    }, this.turnSeconds * 1000);
  }

  destroy() {
    clearTimeout(this.timer);
  }

  newEvent(kind, p) {
    return { kind, playerId: p.id, moves: [], gains: [], log: [], skipped: [] };
  }

  /* ---------- movement ---------- */
  movePlayer(p, steps, kind, ev, by) {
    if (!steps || p.finished || p.dropped) return;
    const from = p.pos;
    let to = p.pos + steps;
    if (to < 0) to = 0;
    if (to > this.finishPos) to = this.finishPos;
    if (to === from) return;
    p.pos = to;
    ev.moves.push({ playerId: p.id, from, to, kind, by: by || null });
  }

  giveItem(p, ev, count) {
    for (let c = 0; c < count; c++) {
      if (p.items.length >= DEFS.MAX_ITEMS) {
        ev.log.push(`${p.name} 的道具欄已滿`);
        return;
      }
      const n = this.active().length;
      const rank = this.rankOf(p);
      const t = n <= 1 ? 0 : (rank - 1) / (n - 1); // 0=領先 1=最後
      const item = weightedPick({
        mushroom: 3,
        banana: 3 * (1 - t) + 1,
        green: 3 * (1 - t) + 1,
        red: 2 + t * 2,
        blue: t * 3.5,
        lightning: t * 3,
        star: t * 2.5,
      });
      p.items.push(item);
      ev.gains.push({ playerId: p.id, item });
      ev.log.push(`${p.name} 獲得 ${DEFS.ITEMS[item].emoji} ${DEFS.ITEMS[item].name}`);
    }
  }

  landEffects(p, ev) {
    if (p.finished || p.dropped) return;
    const tile = p.pos % N;

    // 碰撞：停在同一格的其他玩家被撞退
    for (const o of this.players) {
      if (o === p || o.finished || o.dropped) continue;
      if (o.pos === p.pos) {
        if (o.starTurns > 0) {
          ev.log.push(`${o.name} 有無敵星星，${p.name} 撞不動`);
          continue;
        }
        const push = p.kart === 'monster' ? -2 : -1;
        this.movePlayer(o, push, 'bump', ev, p.id);
        ev.log.push(`${p.name} 撞到 ${o.name}，${o.name} 退 ${-push} 格`);
      }
    }

    // 香蕉
    if (this.bananas[tile] !== undefined) {
      const owner = this.bananas[tile];
      delete this.bananas[tile];
      ev.bananaRemoved = tile;
      if (p.starTurns > 0 || p.kart === 'offroad') {
        ev.log.push(`${p.name} 輾過香蕉但毫髮無傷`);
      } else {
        this.movePlayer(p, -2, 'banana', ev, owner);
        ev.log.push(`${p.name} 踩到香蕉滑倒，退 2 格！`);
        return; // 滑倒後不再觸發格子效果
      }
    }

    if (p.pos >= this.finishPos) return;

    switch (TILES[tile]) {
      case 'item': {
        const bonus = p.kart === 'bike' && Math.random() < 0.5 ? 1 : 0;
        this.giveItem(p, ev, 1 + bonus);
        break;
      }
      case 'boost':
        this.movePlayer(p, 2, 'boost', ev);
        ev.log.push(`${p.name} 踩到加速板，再前進 2 格！`);
        break;
      case 'hazard':
        if (p.kart === 'offroad' || p.starTurns > 0) {
          ev.log.push(`${p.name} 無視油漬`);
        } else {
          p.skipTurn = true;
          ev.log.push(`${p.name} 打滑了，下一回合暫停`);
        }
        break;
      case 'star':
        ev.extraTurn = true;
        ev.log.push(`${p.name} 踩到星星格，可以再擲一次！`);
        break;
      default:
        break;
    }
  }

  checkFinish(ev) {
    for (const p of this.players) {
      if (!p.finished && !p.dropped && p.pos >= this.finishPos) {
        p.finished = true;
        p.rank = this.finishOrder.length + 1;
        this.finishOrder.push(p.id);
        ev.log.push(`🏁 ${p.name} 完成比賽，第 ${p.rank} 名！`);
      }
    }
    if (this.active().length === 0 || (this.players.length > 1 && this.active().length <= 1 && this.finishOrder.length > 0)) {
      // 剩最後一位時自動排入名次
      for (const p of this.active()) {
        p.finished = true;
        p.rank = this.finishOrder.length + 1;
        this.finishOrder.push(p.id);
      }
      this.finished = true;
      this.phase = 'over';
      ev.gameOver = true;
      ev.log.push('🎉 比賽結束！');
      clearTimeout(this.timer);
    }
  }

  nextTurn(ev, extraFor) {
    if (this.finished) return;
    this.usedItemThisTurn = false;
    if (extraFor && !extraFor.finished && !extraFor.dropped) {
      this.armTimer();
      return;
    }
    const n = this.players.length;
    for (let guard = 0; guard < n * 2; guard++) {
      this.turnIndex = (this.turnIndex + 1) % n;
      if (this.turnIndex === 0) this.turnNumber++;
      const p = this.players[this.turnIndex];
      if (p.finished || p.dropped) continue;
      if (p.skipTurn) {
        p.skipTurn = false;
        ev.skipped.push(p.id);
        ev.log.push(`${p.name} 這回合暫停`);
        continue;
      }
      this.armTimer();
      return;
    }
    this.armTimer();
  }

  /* ---------- actions ---------- */
  roll(playerId, auto) {
    const p = this.getPlayer(playerId);
    if (!p) return { error: '找不到玩家' };
    if (this.finished) return { error: '遊戲已結束' };
    if (this.current.id !== playerId) return { error: '還沒輪到你' };
    if (this.phase !== 'await') return { error: '現在不能擲骰' };

    const ev = this.newEvent('roll', p);
    ev.auto = !!auto;
    const die = 1 + rand(6);
    let bonus = 0;
    const notes = [];
    if (p.kart === 'sport' && die === 6) {
      bonus += 1;
      notes.push('跑車 +1');
    }
    if (p.starTurns > 0) {
      bonus += 2;
      notes.push('星星 +2');
    }
    ev.die = die;
    ev.bonus = bonus;
    ev.log.push(`${auto ? '⏱️ ' : ''}${p.name} 擲出 ${die}${bonus ? `（${notes.join('、')}）` : ''}`);
    this.movePlayer(p, die + bonus, 'roll', ev);
    this.landEffects(p, ev);
    if (p.starTurns > 0) p.starTurns--;
    this.checkFinish(ev);
    this.nextTurn(ev, ev.extraTurn ? p : null);
    ev.state = this.snapshot();
    return ev;
  }

  useItem(playerId, slot) {
    const p = this.getPlayer(playerId);
    if (!p) return { error: '找不到玩家' };
    if (this.finished) return { error: '遊戲已結束' };
    if (this.current.id !== playerId) return { error: '還沒輪到你' };
    if (this.phase !== 'await') return { error: '現在不能使用道具' };
    if (this.usedItemThisTurn) return { error: '每回合只能使用一個道具' };
    const item = p.items[slot];
    if (!item) return { error: '沒有這個道具' };

    const ev = this.newEvent('item', p);
    ev.item = item;
    p.items.splice(slot, 1);
    this.usedItemThisTurn = true;
    const info = DEFS.ITEMS[item];
    ev.log.push(`${p.name} 使用了 ${info.emoji} ${info.name}`);
    const others = this.active().filter((o) => o !== p);
    const hit = (o, steps) => {
      if (o.starTurns > 0) {
        ev.log.push(`${o.name} 有無敵星星，免疫！`);
        return;
      }
      this.movePlayer(o, -steps, item, ev, p.id);
      ev.log.push(`${o.name} 被擊中，退 ${steps} 格`);
    };

    switch (item) {
      case 'mushroom':
        this.movePlayer(p, 3, 'mushroom', ev);
        this.landEffects(p, ev);
        break;
      case 'banana': {
        const tile = p.pos % N;
        if (TILES[tile] === 'start' || this.bananas[tile] !== undefined) {
          ev.log.push('這格不能放香蕉，道具退回');
          p.items.push('banana');
          this.usedItemThisTurn = false;
        } else {
          this.bananas[tile] = p.id;
          ev.bananaPlaced = tile;
          ev.log.push(`${p.name} 在第 ${tile} 格放了香蕉`);
        }
        break;
      }
      case 'green': {
        if (others.length) hit(others[rand(others.length)], 3);
        else ev.log.push('沒有可以擊中的對手');
        break;
      }
      case 'red': {
        const ahead = others.filter((o) => o.pos > p.pos).sort((a, b) => a.pos - b.pos);
        const target = ahead[0] || others.sort((a, b) => b.pos - a.pos)[0];
        if (target) hit(target, 4);
        else ev.log.push('沒有可以擊中的對手');
        break;
      }
      case 'blue': {
        const leader = [...others].sort((a, b) => b.pos - a.pos)[0];
        if (leader) hit(leader, 5);
        else ev.log.push('沒有可以擊中的對手');
        break;
      }
      case 'lightning':
        others.forEach((o) => hit(o, 2));
        if (!others.length) ev.log.push('沒有可以擊中的對手');
        break;
      case 'star':
        p.starTurns = 2;
        ev.log.push(`${p.name} 進入無敵狀態！`);
        break;
      default:
        break;
    }

    this.checkFinish(ev);
    if (p.finished || this.finished) {
      this.nextTurn(ev, null);
    } else {
      this.armTimer();
    }
    ev.state = this.snapshot();
    return ev;
  }

  removePlayer(playerId) {
    const p = this.getPlayer(playerId);
    if (!p || p.dropped) return null;
    p.dropped = true;
    const ev = this.newEvent('leave', p);
    ev.log.push(`${p.name} 離開了比賽`);
    this.checkFinish(ev);
    if (!this.finished && this.current.id === playerId) {
      this.nextTurn(ev, null);
    }
    ev.state = this.snapshot();
    return ev;
  }

  /* ---------- snapshot ---------- */
  snapshot() {
    const ranking = this.ranking();
    return {
      laps: this.laps,
      trackLength: N,
      finishPos: this.finishPos,
      currentId: this.finished ? null : this.current.id,
      phase: this.phase,
      turnNumber: this.turnNumber,
      usedItemThisTurn: this.usedItemThisTurn,
      turnDeadline: this.turnDeadline,
      bananas: { ...this.bananas },
      finished: this.finished,
      finishOrder: [...this.finishOrder],
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        character: p.character,
        kart: p.kart,
        seat: p.seat,
        pos: p.pos,
        lap: Math.min(this.laps, Math.floor(p.pos / N)),
        tile: p.pos % N,
        items: [...p.items],
        starTurns: p.starTurns,
        skipTurn: p.skipTurn,
        finished: p.finished,
        rank: p.rank,
        dropped: p.dropped,
        standing: ranking.indexOf(p) + 1,
      })),
    };
  }
}

module.exports = { Game, ITEM_IDS };
