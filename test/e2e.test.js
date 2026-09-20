'use strict';
// 端對端測試：啟動伺服器，兩個 socket.io 客戶端開房、加入、開始、打完一整場
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

test('two players can create/join a room and finish a race', async (t) => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), BASE_PATH: BASE, TURN_SECONDS: '30' },
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
  assert.strictEqual(rooms[0].name, '測試房');

  const joined = await ask(b, 'room:join', created.room.id);
  assert.ok(joined.room);
  assert.strictEqual(joined.room.players.length, 2);

  // 房主未全員準備時不能開始
  const early = await ask(a, 'room:start');
  assert.ok(early.error);
  b.emit('room:ready', true);
  await wait(50);

  const startA = once(a, 'game:start');
  const startB = once(b, 'game:start');
  const res = await ask(a, 'room:start');
  assert.ok(res.ok, JSON.stringify(res));
  const [sa] = await Promise.all([startA, startB]);
  assert.strictEqual(sa.state.players.length, 2);
  assert.strictEqual(sa.state.currentId, ja.playerId);

  // 非當前玩家不能擲骰
  const bad = await ask(b, 'game:roll');
  assert.ok(bad.error);

  // 輪流擲骰直到結束
  let state = sa.state;
  let over = null;
  a.on('game:over', (p) => (over = p));
  const socks = { [ja.playerId]: a, [jb.playerId]: b };
  let turns = 0;
  while (!over && turns < 200) {
    const cur = socks[state.currentId];
    const me = state.players.find((p) => p.id === state.currentId);
    if (me.items.length && !state.usedItemThisTurn) {
      const evP = once(a, 'game:action');
      const r = await ask(cur, 'game:useItem', { slot: 0 });
      assert.ok(r.ok, JSON.stringify(r));
      state = (await evP).state;
      if (state.finished) break;
    }
    const evP = once(a, 'game:action');
    const r = await ask(cur, 'game:roll');
    assert.ok(r.ok, JSON.stringify(r));
    const ev = await evP;
    assert.strictEqual(ev.kind, 'roll');
    assert.ok(ev.die >= 1 && ev.die <= 6);
    state = ev.state;
    turns++;
  }
  await wait(50);
  assert.ok(over, 'game should be over');
  assert.strictEqual(over.result.finishOrder.length, 2);
  assert.strictEqual(over.room.status, 'waiting');
  console.log(`race finished in ${turns} turns, order: ${over.result.finishOrder.map((id) => over.result.players.find((p) => p.id === id).name).join(' > ')}`);

  // 離開房間後房間應消失
  await ask(a, 'room:leave');
  await ask(b, 'room:leave');
  const after = await ask(a, 'rooms:list');
  assert.strictEqual(after.length, 0);
});
