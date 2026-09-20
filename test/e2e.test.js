'use strict';
// 端對端測試：啟動伺服器，兩個 socket.io 客戶端開房、加入、開始，模擬跑完一整場競速
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io } = require('socket.io-client');

const PORT = 3999;
const BASE = '/mario';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function ask(sock, ev, payload) {
  return new Promise((resolve) => (payload === undefined ? sock.emit(ev, resolve) : sock.emit(ev, payload, resolve)));
}
function once(sock, ev) {
  return new Promise((resolve) => sock.once(ev, resolve));
}
function waitEvent(sock, type, ms = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting race:event ${type}`)), ms);
    const h = (ev) => {
      if (ev.type === type) {
        clearTimeout(timer);
        sock.off('race:event', h);
        resolve(ev);
      }
    };
    sock.on('race:event', h);
  });
}

test('two players can create/join a room and finish a race', async (t) => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), BASE_PATH: BASE },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('listening') && resolve()));
  t.after(() => server.kill());

  const url = `http://localhost:${PORT}`;
  const opts = { path: `${BASE}/socket.io`, transports: ['websocket'] };
  const a = io(url, opts);
  const b = io(url, opts);
  t.after(() => {
    a.close();
    b.close();
  });
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);

  const ja = await ask(a, 'join', { name: 'Alice', character: 'mario', kart: 'sport' });
  const jb = await ask(b, 'join', { name: 'Bob', character: 'yoshi', kart: 'offroad' });
  assert.ok(ja.playerId && jb.playerId);

  const created = await ask(a, 'room:create', { name: '測試房', laps: 1, maxPlayers: 4 });
  assert.ok(created.room, JSON.stringify(created));
  const rooms = await ask(b, 'rooms:list');
  assert.strictEqual(rooms.length, 1);
  const joined = await ask(b, 'room:join', created.room.id);
  assert.strictEqual(joined.room.players.length, 2);

  const early = await ask(a, 'room:start');
  assert.ok(early.error, '未準備不能開始');
  b.emit('room:ready', true);
  await wait(50);

  const startA = once(a, 'game:start');
  const res = await ask(a, 'room:start');
  assert.ok(res.ok, JSON.stringify(res));
  const sa = await startA;
  assert.strictEqual(sa.state.phase, 'countdown');
  assert.strictEqual(sa.state.players.length, 2);

  // 倒數結束
  await waitEvent(a, 'go', 8000);
  const snap = await once(a, 'race:snapshot');
  assert.strictEqual(snap.phase, 'racing');

  // 撿道具箱 → 拿到道具 → 使用
  const pick = await ask(a, 'race:pickup', { box: 0 });
  assert.ok(pick.ok && pick.item, JSON.stringify(pick));
  const again = await ask(a, 'race:pickup', { box: 0 });
  assert.ok(again.error, '同一個箱子要等重生');
  const use = await ask(a, 'race:use', { x: 0, y: 0, z: 0 });
  assert.ok(use.ok, JSON.stringify(use));

  // Alice 沿著賽道進度 t 前進一圈（經過三個檢查點再回到 0）
  const steps = [0.1, 0.2, 0.3, 0.45, 0.55, 0.7, 0.8, 0.9, 0.97, 0.02];
  const finishP = waitEvent(a, 'finish', 5000);
  for (const tt of steps) {
    a.emit('race:state', { x: tt * 100, y: 0, z: 0, rot: 0, speed: 30, t: tt, shells: [] });
    await wait(30);
  }
  const fin = await finishP;
  assert.strictEqual(fin.playerId, ja.playerId);
  assert.strictEqual(fin.rank, 1);

  // Bob 也跑完 → 比賽結束
  const overP = once(a, 'game:over');
  for (const tt of steps) {
    b.emit('race:state', { x: tt * 100, y: 0, z: 0, rot: 0, speed: 30, t: tt, shells: [] });
    await wait(30);
  }
  const over = await overP;
  assert.strictEqual(over.result.finishOrder.length, 2);
  assert.strictEqual(over.result.players[0].name, 'Alice');
  assert.strictEqual(over.room.status, 'waiting');
  console.log(`race finished: ${over.result.players.map((p) => `${p.rank}.${p.name}`).join(' ')}`);

  await ask(a, 'room:leave');
  await ask(b, 'room:leave');
  const after = await ask(a, 'rooms:list');
  assert.strictEqual(after.length, 0);
});
