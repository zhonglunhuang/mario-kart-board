'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const crypto = require('crypto');
const { RoomManager } = require('./rooms.js');

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
router.get('/healthz', (req, res) => res.json({ ok: true, rooms: manager.rooms.size, players: manager.players.size }));

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
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5,
});
const manager = new RoomManager(io, { turnSeconds: TURN_SECONDS });

io.on('connection', (socket) => {
  const reply = (cb, data) => typeof cb === 'function' && cb(data);

  socket.on('join', (profile = {}, cb) => {
    const p = manager.addPlayer(socket, profile);
    reply(cb, { ok: true, playerId: p.id, profile: { name: p.name, character: p.character, kart: p.kart } });
    socket.emit('rooms', manager.roomList());
  });

  socket.on('profile:update', (profile = {}, cb) => {
    const p = manager.updateProfile(socket.id, profile);
    reply(cb, p ? { ok: true, profile: { name: p.name, character: p.character, kart: p.kart } } : { error: '請先加入' });
  });

  socket.on('rooms:list', (cb) => reply(cb, manager.roomList()));
  socket.on('room:create', (opts = {}, cb) => reply(cb, manager.createRoom(socket.id, opts)));
  socket.on('room:join', (roomId, cb) => reply(cb, manager.joinRoom(socket.id, String(roomId || ''))));
  socket.on('room:leave', (cb) => {
    manager.leaveRoom(socket.id);
    reply(cb, { ok: true });
  });
  socket.on('room:ready', (ready) => manager.setReady(socket.id, ready));
  socket.on('room:settings', (opts = {}, cb) => reply(cb, manager.updateSettings(socket.id, opts)));
  socket.on('room:start', (cb) => reply(cb, manager.startGame(socket.id)));
  // 競速：位置回報（高頻、不回覆）、撿道具箱、使用道具、命中回報
  socket.on('race:state', (payload) => manager.raceAction(socket.id, 'state', payload));
  socket.on('race:pickup', (payload, cb) => reply(cb, manager.raceAction(socket.id, 'pickup', payload)));
  socket.on('race:use', (payload, cb) => reply(cb, manager.raceAction(socket.id, 'use', payload)));
  socket.on('race:hit', (payload, cb) => reply(cb, manager.raceAction(socket.id, 'hit', payload)));
  socket.on('game:sync', (cb) => reply(cb, manager.getState(socket.id)));
  // 語音對話訊號交換
  socket.on('voice:join', (cb) => reply(cb, manager.voiceJoin(socket.id)));
  socket.on('voice:leave', () => manager.voiceLeave(socket.id));
  socket.on('voice:signal', (payload) => manager.voiceSignal(socket.id, payload));

  socket.on('chat', (text) => {
    const p = manager.players.get(socket.id);
    if (!p || !p.roomId) return;
    const msg = String(text || '')
      .replace(/[\u0000-\u001f<>]/g, '')
      .trim()
      .slice(0, 120);
    if (!msg) return;
    io.to(p.roomId).emit('chat', { from: p.name, playerId: p.id, text: msg, at: Date.now() });
  });

  socket.on('disconnect', () => manager.removePlayer(socket.id));
});

server.listen(PORT, () => {
  console.log(`Mario Kart Board server v${APP_VERSION} listening on http://0.0.0.0:${PORT}${BASE || ''}/  (socket.io path: ${SIO_PATH})`);
});
