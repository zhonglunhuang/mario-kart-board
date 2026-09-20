'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const crypto = require('crypto');
const { RoomManager } = require('./rooms.js');
const log = require('./log.js');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const TURN_SECONDS = parseInt(process.env.TURN_SECONDS, 10) || 45;
// 部署在子路徑（例如 http://host/mario/）時使用；設為 "/" 代表根路徑
let BASE = (process.env.BASE_PATH || '/mario').trim();
if (!BASE.startsWith('/')) BASE = '/' + BASE;
BASE = BASE.replace(/\/+$/, '');
const SIO_PATH = `${BASE}/socket.io`;

// 版本號：部署時寫入 VERSION 檔（git 短雜湊 + 時間）；沒有就用啟動時間
const fs = require('fs');
let APP_VERSION = '';
try {
  APP_VERSION = fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim();
} catch (e) {
  APP_VERSION = `dev-${Date.now().toString(36)}`;
}
const SW_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

const router = express.Router();
router.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three'), { maxAge: '7d' }));
router.use('/models', express.static(path.join(__dirname, '..', 'public', 'models'), { maxAge: '7d', immutable: false }));
router.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Service-Worker-Allowed', BASE ? BASE + '/' : '/');
  res.send(SW_SOURCE.replace('__VERSION__', APP_VERSION));
});
router.use(
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: '5m',
    etag: true,
    setHeaders: (res, filePath) => {
      // 入口頁與 manifest 不快取，才能立刻拿到新版
      if (filePath.endsWith('.html') || filePath.endsWith('.webmanifest')) res.set('Cache-Control', 'no-cache');
    },
  }),
);
router.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const playing = [...manager.rooms.values()].filter((r) => r.game && !r.game.finished).length;
  res.json({ ok: true, version: APP_VERSION, uptimeSec: Math.round(process.uptime()), rooms: manager.rooms.size, playing, players: manager.players.size });
});

router.get('/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ httpsUrl: process.env.PUBLIC_HTTPS_URL || null, version: APP_VERSION });
});

// WebRTC ICE 設定：STUN + （若有設定）自架 TURN，TURN 憑證為 12 小時有效的暫時憑證
router.get('/ice', (req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const secret = process.env.TURN_SECRET;
  const host = process.env.TURN_HOST;
  if (secret && host) {
    const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:mario`;
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
    iceServers.push({ urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`], username, credential });
  }
  res.set('Cache-Control', 'no-store');
  res.json({ iceServers });
});

if (BASE) {
  // 注意：Express 的 app.get('/mario') 也會匹配 '/mario/'，所以要用精確比對，否則會無限轉址
  app.use((req, res, next) => {
    if (req.path === BASE || req.path === '/') return res.redirect(301, BASE + '/');
    next();
  });
  app.use(BASE, router);
} else {
  app.use(router);
}

const server = http.createServer(app);
const io = new Server(server, {
  path: SIO_PATH,
  pingInterval: 10000,
  pingTimeout: 30000, // 手機切到背景 / 旋轉時暫停 JS，給多一點寬限
  maxHttpBufferSize: 1e5,
});
const manager = new RoomManager(io, { turnSeconds: TURN_SECONDS });

// 房間狀態跨重啟保存
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
try {
  if (fs.existsSync(ROOMS_FILE)) {
    manager.restore(JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')));
    fs.unlinkSync(ROOMS_FILE);
  }
} catch (e) {
  log.warn('restore rooms failed', { error: e.message });
}
function saveRooms() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(manager.dump()));
  } catch (e) {
    log.warn('save rooms failed', { error: e.message });
  }
}

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const playing = [...manager.rooms.values()].filter((r) => r.game && !r.game.finished).length;
  log.warn('shutdown requested', { signal, players: manager.players.size, rooms: manager.rooms.size, playing });
  saveRooms();
  io.emit('server:restart', { seconds: 3 });
  setTimeout(() => {
    io.close();
    server.close();
    process.exit(0);
  }, 700);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (e) => log.error('uncaughtException', { error: e.stack || String(e) }));
process.on('unhandledRejection', (e) => log.error('unhandledRejection', { error: e?.stack || String(e) }));

io.on('connection', (socket) => {
  const reply = (cb, data) => typeof cb === 'function' && cb(data);
  const ip = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '').split(',')[0].trim();
  const ua = String(socket.handshake.headers['user-agent'] || '').slice(0, 80);
  const connectedAt = Date.now();
  log.info('connect', { id: socket.id, ip, transport: socket.conn.transport.name, ua });
  socket.conn.on('upgrade', (t) => log.info('transport upgrade', { id: socket.id, transport: t.name }));
  // 每個事件處理都包起來，任何例外只記錄不讓程序崩潰
  const on = (event, handler) =>
    socket.on(event, (...args) => {
      try {
        handler(...args);
      } catch (e) {
        log.error(`handler error: ${event}`, { id: socket.id, error: e.stack || String(e) });
        const cb = args.find((a) => typeof a === 'function');
        if (cb) cb({ error: '伺服器處理錯誤' });
      }
    });
  socket.on('client:log', (entry) => {
    const p = manager.players.get(socket.id);
    log.info('client log', { id: socket.id, name: p?.name, ...(entry && typeof entry === 'object' ? { msg: String(entry.msg || '').slice(0, 200), data: entry.data } : {}) });
  });

  on('join', (profile = {}, cb) => {
    const p = manager.addPlayer(socket, profile);
    reply(cb, { ok: true, playerId: p.id, profile: { name: p.name, character: p.character, kart: p.kart } });
    socket.emit('rooms', manager.roomList());
  });

  on('profile:update', (profile = {}, cb) => {
    const p = manager.updateProfile(socket.id, profile);
    reply(cb, p ? { ok: true, profile: { name: p.name, character: p.character, kart: p.kart } } : { error: '請先加入' });
  });

  on('rooms:list', (cb) => reply(cb, manager.roomList()));
  on('room:create', (opts = {}, cb) => reply(cb, manager.createRoom(socket.id, opts)));
  on('room:join', (roomId, cb) => reply(cb, manager.joinRoom(socket.id, String(roomId || ''))));
  on('room:leave', (cb) => {
    manager.leaveRoom(socket.id);
    reply(cb, { ok: true });
  });
  on('room:ready', (ready) => manager.setReady(socket.id, ready));
  on('room:settings', (opts = {}, cb) => reply(cb, manager.updateSettings(socket.id, opts)));
  on('room:start', (cb) => reply(cb, manager.startGame(socket.id)));
  // 競速：位置回報（高頻、不回覆）、撿道具箱、使用道具、命中回報
  on('race:state', (payload) => manager.raceAction(socket.id, 'state', payload));
  on('race:pickup', (payload, cb) => reply(cb, manager.raceAction(socket.id, 'pickup', payload)));
  on('race:use', (payload, cb) => reply(cb, manager.raceAction(socket.id, 'use', payload)));
  on('race:hit', (payload, cb) => reply(cb, manager.raceAction(socket.id, 'hit', payload)));
  on('game:sync', (cb) => reply(cb, manager.getState(socket.id)));
  // 語音對話訊號交換
  on('voice:join', (cb) => reply(cb, manager.voiceJoin(socket.id)));
  on('voice:leave', () => manager.voiceLeave(socket.id));
  on('voice:signal', (payload) => manager.voiceSignal(socket.id, payload));

  on('chat', (text) => {
    const p = manager.players.get(socket.id);
    if (!p || !p.roomId) return;
    const msg = String(text || '')
      .replace(/[\u0000-\u001f<>]/g, '')
      .trim()
      .slice(0, 120);
    if (!msg) return;
    io.to(p.roomId).emit('chat', { from: p.name, playerId: p.id, text: msg, at: Date.now() });
  });

  socket.on('disconnect', (reason) => {
    const p = manager.players.get(socket.id);
    const room = p?.roomId ? manager.rooms.get(p.roomId) : null;
    log.info('disconnect', { id: socket.id, name: p?.name, reason, room: p?.roomId || null, racing: !!(room?.game && !room.game.finished), connectedSec: Math.round((Date.now() - connectedAt) / 1000) });
    manager.removePlayer(socket.id);
  });
});

server.listen(PORT, () => {
  log.info(`Mario Kart Board server v${APP_VERSION} listening on http://0.0.0.0:${PORT}${BASE || ''}/  (socket.io path: ${SIO_PATH})`);
});
