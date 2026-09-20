'use strict';
const crypto = require('crypto');
const DEFS = require('../public/shared/defs.js');
const { Race } = require('./game.js');

const CHAR_IDS = new Set(DEFS.CHARACTERS.map((c) => c.id));
const KART_IDS = new Set(DEFS.KARTS.map((k) => k.id));

function clean(str, max) {
  return String(str || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);
}

class RoomManager {
  constructor(io, opts) {
    this.io = io;
    this.turnSeconds = opts.turnSeconds || 45;
    this.players = new Map(); // socketId -> player
    this.rooms = new Map(); // roomId -> room
  }

  /* ---------- players ---------- */
  addPlayer(socket, profile) {
    const p = {
      id: socket.id,
      name: clean(profile.name, 12) || `玩家${socket.id.slice(0, 4)}`,
      character: CHAR_IDS.has(profile.character) ? profile.character : 'mario',
      kart: KART_IDS.has(profile.kart) ? profile.kart : 'standard',
      roomId: null,
      ready: false,
    };
    this.players.set(socket.id, p);
    return p;
  }

  updateProfile(socketId, profile) {
    const p = this.players.get(socketId);
    if (!p) return null;
    if (profile.name !== undefined) p.name = clean(profile.name, 12) || p.name;
    if (CHAR_IDS.has(profile.character)) p.character = profile.character;
    if (KART_IDS.has(profile.kart)) p.kart = profile.kart;
    if (p.roomId) this.broadcastRoom(p.roomId);
    return p;
  }

  removePlayer(socketId) {
    const p = this.players.get(socketId);
    if (!p) return;
    if (p.roomId) this.leaveRoom(socketId);
    this.players.delete(socketId);
  }

  /* ---------- rooms ---------- */
  publicRoom(room) {
    return {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      laps: room.laps,
      map: room.map,
      bots: room.bots,
      difficulty: room.difficulty,
      variant: { ...room.variant },
      status: room.status,
      voice: [...room.voice],
      players: room.players.map((id) => {
        const p = this.players.get(id);
        return { id, name: p.name, character: p.character, kart: p.kart, ready: p.ready, isHost: id === room.hostId };
      }),
    };
  }

  roomList() {
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      name: r.name,
      hostName: this.players.get(r.hostId)?.name || '?',
      count: r.players.length,
      maxPlayers: r.maxPlayers,
      laps: r.laps,
      map: r.map,
      bots: r.bots,
      status: r.status,
    }));
  }

  broadcastList() {
    this.io.emit('rooms', this.roomList());
  }

  broadcastRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.io.to(roomId).emit('room:state', this.publicRoom(room));
  }

  createRoom(socketId, opts) {
    const p = this.players.get(socketId);
    if (!p) return { error: '請先設定玩家資料' };
    if (p.roomId) return { error: '你已經在房間裡了' };
    if (this.rooms.size >= 200) return { error: '房間數已達上限' };
    const id = crypto.randomBytes(3).toString('hex');
    const room = {
      id,
      name: clean(opts.name, 20) || `${p.name} 的房間`,
      hostId: socketId,
      maxPlayers: Math.min(8, Math.max(2, parseInt(opts.maxPlayers, 10) || 4)),
      laps: Math.min(5, Math.max(1, parseInt(opts.laps, 10) || 3)),
      map: DEFS.MAPS[opts.map] ? opts.map : DEFS.DEFAULT_MAP,
      bots: Math.min(7, Math.max(0, parseInt(opts.bots, 10) || 0)),
      difficulty: DEFS.DIFFICULTIES.some((d) => d.id === opts.difficulty) ? opts.difficulty : 'normal',
      variant: { reverse: false, mirror: false, time: 'auto', weather: 'auto' },
      voice: new Set(),
      status: 'waiting',
      players: [],
      game: null,
      createdAt: Date.now(),
    };
    this.rooms.set(id, room);
    return this.joinRoom(socketId, id);
  }

  joinRoom(socketId, roomId) {
    const p = this.players.get(socketId);
    const room = this.rooms.get(roomId);
    if (!p) return { error: '請先設定玩家資料' };
    if (!room) return { error: '房間不存在' };
    if (p.roomId) return { error: '你已經在房間裡了' };
    if (room.status !== 'waiting') return { error: '遊戲進行中，無法加入' };
    if (room.players.length >= room.maxPlayers) return { error: '房間已滿' };
    room.players.push(socketId);
    p.roomId = roomId;
    p.ready = socketId === room.hostId;
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) socket.join(roomId);
    this.broadcastRoom(roomId);
    this.broadcastList();
    return { room: this.publicRoom(room) };
  }

  leaveRoom(socketId) {
    const p = this.players.get(socketId);
    if (!p || !p.roomId) return;
    const room = this.rooms.get(p.roomId);
    const roomId = p.roomId;
    p.roomId = null;
    p.ready = false;
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) socket.leave(roomId);
    if (!room) return;
    room.players = room.players.filter((id) => id !== socketId);
    if (room.voice.has(socketId)) {
      room.voice.delete(socketId);
      this.io.to(roomId).emit('voice:peer-left', { id: socketId });
    }

    if (room.game && !room.game.finished) {
      room.game.removePlayer(socketId);
    }

    if (room.players.length === 0) {
      if (room.game) room.game.destroy();
      this.rooms.delete(roomId);
    } else {
      if (room.hostId === socketId) {
        room.hostId = room.players[0];
        const host = this.players.get(room.hostId);
        if (host) host.ready = true;
        if (room.game && !room.game.finished) room.game.setHost(room.hostId);
      }
      this.broadcastRoom(roomId);
    }
    this.broadcastList();
  }

  setReady(socketId, ready) {
    const p = this.players.get(socketId);
    if (!p || !p.roomId) return;
    const room = this.rooms.get(p.roomId);
    if (!room || room.status !== 'waiting') return;
    p.ready = socketId === room.hostId ? true : !!ready;
    this.broadcastRoom(p.roomId);
  }

  updateSettings(socketId, opts) {
    const p = this.players.get(socketId);
    if (!p || !p.roomId) return { error: '不在房間裡' };
    const room = this.rooms.get(p.roomId);
    if (!room || room.hostId !== socketId) return { error: '只有房主可以更改設定' };
    if (room.status !== 'waiting') return { error: '遊戲進行中' };
    if (opts.laps) room.laps = Math.min(5, Math.max(1, parseInt(opts.laps, 10) || room.laps));
    if (opts.maxPlayers) room.maxPlayers = Math.min(8, Math.max(room.players.length, parseInt(opts.maxPlayers, 10) || room.maxPlayers));
    if (opts.name !== undefined) room.name = clean(opts.name, 20) || room.name;
    if (opts.map && DEFS.MAPS[opts.map]) room.map = opts.map;
    if (opts.bots !== undefined) room.bots = Math.min(7, Math.max(0, parseInt(opts.bots, 10) || 0));
    if (opts.difficulty && DEFS.DIFFICULTIES.some((d) => d.id === opts.difficulty)) room.difficulty = opts.difficulty;
    if (opts.variant && typeof opts.variant === 'object') {
      const v = opts.variant;
      if (v.reverse !== undefined) room.variant.reverse = !!v.reverse;
      if (v.mirror !== undefined) room.variant.mirror = !!v.mirror;
      if (v.time && ['auto', ...DEFS.VARIANTS.time.map((x) => x.id)].includes(v.time)) room.variant.time = v.time;
      if (v.weather && ['auto', ...DEFS.VARIANTS.weather.map((x) => x.id)].includes(v.weather)) room.variant.weather = v.weather;
    }
    this.broadcastRoom(room.id);
    this.broadcastList();
    return { ok: true };
  }

  startGame(socketId) {
    const p = this.players.get(socketId);
    if (!p || !p.roomId) return { error: '不在房間裡' };
    const room = this.rooms.get(p.roomId);
    if (!room) return { error: '房間不存在' };
    if (room.hostId !== socketId) return { error: '只有房主可以開始遊戲' };
    if (room.status !== 'waiting') return { error: '遊戲已經開始' };
    if (room.players.length < 1) return { error: '人數不足' };
    const notReady = room.players.map((id) => this.players.get(id)).filter((q) => q && !q.ready);
    if (notReady.length) return { error: `${notReady.map((q) => q.name).join('、')} 尚未準備` };

    const roster = room.players.map((id) => {
      const q = this.players.get(id);
      return { id, name: q.name, character: q.character, kart: q.kart };
    });
    const used = new Set(roster.map((q) => q.name));
    const names = DEFS.BOT_NAMES.filter((n) => !used.has(n));
    const botCount = Math.min(room.bots, Math.max(0, 8 - roster.length));
    for (let i = 0; i < botCount; i++) {
      roster.push({
        id: `bot-${room.id}-${i + 1}`,
        name: names[i % names.length] || `AI${i + 1}`,
        character: DEFS.CHARACTERS[Math.floor(Math.random() * DEFS.CHARACTERS.length)].id,
        kart: DEFS.KARTS[Math.floor(Math.random() * DEFS.KARTS.length)].id,
        bot: true,
      });
    }
    room.status = 'playing';
    room.game = new Race(roster, {
      laps: room.laps,
      map: room.map,
      variant: room.variant,
      difficulty: room.difficulty,
      hostId: room.hostId,
      emit: (event, payload) => this.io.to(room.id).emit(event, payload),
      onOver: () => this.endGame(room),
    });
    this.io.to(room.id).emit('game:start', { room: this.publicRoom(room), state: room.game.snapshot() });
    this.broadcastList();
    return { ok: true };
  }

  raceAction(socketId, action, payload) {
    const p = this.players.get(socketId);
    if (!p || !p.roomId) return { error: '不在房間裡' };
    const room = this.rooms.get(p.roomId);
    if (!room || !room.game) return { error: '遊戲尚未開始' };
    const race = room.game;
    switch (action) {
      case 'state': {
        race.updateState(socketId, payload || {});
        if (Array.isArray(payload?.bots)) for (const b of payload.bots.slice(0, 7)) race.updateState(socketId, b, String(b.id || ''));
        return null;
      }
      case 'pickup':
        return race.pickup(socketId, payload?.box, payload?.as);
      case 'use':
        return race.useItem(socketId, payload || {}, payload?.as);
      case 'hit':
        return race.hit(socketId, payload || {});
      default:
        return { error: '未知的動作' };
    }
  }

  endGame(room) {
    if (!room.game) return;
    const result = room.game.result();
    room.game.destroy();
    room.game = null;
    room.status = 'waiting';
    for (const id of room.players) {
      const q = this.players.get(id);
      if (q) q.ready = id === room.hostId;
    }
    this.io.to(room.id).emit('game:over', { result, room: this.publicRoom(room) });
    this.broadcastRoom(room.id);
    this.broadcastList();
  }

  /* ---------- 語音 ---------- */
  voiceJoin(socketId) {
    const p = this.players.get(socketId);
    if (!p || !p.roomId) return { error: '不在房間裡' };
    const room = this.rooms.get(p.roomId);
    if (!room) return { error: '房間不存在' };
    const peers = [...room.voice].filter((id) => id !== socketId).map((id) => ({ id, name: this.players.get(id)?.name || '?' }));
    room.voice.add(socketId);
    this.io.to(room.id).except(socketId).emit('voice:peer-joined', { id: socketId, name: p.name });
    this.broadcastRoom(room.id);
    return { ok: true, peers };
  }

  voiceLeave(socketId) {
    const p = this.players.get(socketId);
    if (!p || !p.roomId) return;
    const room = this.rooms.get(p.roomId);
    if (!room || !room.voice.has(socketId)) return;
    room.voice.delete(socketId);
    this.io.to(room.id).emit('voice:peer-left', { id: socketId });
    this.broadcastRoom(room.id);
  }

  voiceSignal(socketId, payload) {
    const p = this.players.get(socketId);
    if (!p || !p.roomId || !payload) return;
    const room = this.rooms.get(p.roomId);
    const to = String(payload.to || '');
    if (!room || !room.players.includes(to)) return;
    this.io.to(to).emit('voice:signal', { from: socketId, name: p.name, data: payload.data });
  }

  getState(socketId) {
    const p = this.players.get(socketId);
    if (!p || !p.roomId) return null;
    const room = this.rooms.get(p.roomId);
    if (!room) return null;
    return { room: this.publicRoom(room), state: room.game ? room.game.snapshot() : null };
  }
}

module.exports = { RoomManager };
