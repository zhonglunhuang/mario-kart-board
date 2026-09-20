'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms.js');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const TURN_SECONDS = parseInt(process.env.TURN_SECONDS, 10) || 45;
// 部署在子路徑（例如 http://host/mario/）時使用；設為 "/" 代表根路徑
let BASE = (process.env.BASE_PATH || '/mario').trim();
if (!BASE.startsWith('/')) BASE = '/' + BASE;
BASE = BASE.replace(/\/+$/, '');
const SIO_PATH = `${BASE}/socket.io`;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

const router = express.Router();
router.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three'), { maxAge: '7d' }));
router.use('/models', express.static(path.join(__dirname, '..', 'public', 'models'), { maxAge: '7d', immutable: false }));
router.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '5m', etag: true }));
router.get('/healthz', (req, res) => res.json({ ok: true, rooms: manager.rooms.size, players: manager.players.size }));

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
  console.log(`Mario Kart Board server listening on http://0.0.0.0:${PORT}${BASE || ''}/  (socket.io path: ${SIO_PATH})`);
});
