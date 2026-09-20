import { KartScene } from './scene.js';

const DEFS = window.DEFS;
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 依照目前網址自動判斷 base path（例如 /mario）
const BASE = location.pathname.replace(/\/[^/]*$/, '');
const socket = io({ path: `${BASE}/socket.io`, transports: ['websocket', 'polling'] });

const state = {
  entered: false,
  me: { id: null, name: '', character: 'mario', kart: 'standard' },
  room: null,
  game: null,
  scene: null,
  busy: false,
  queue: [],
  pendingOver: null,
  logLines: [],
  timerHandle: null,
  get isMobile() {
    return window.matchMedia('(max-width: 720px)').matches;
  },
};

/* ---------- 工具 ---------- */
let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
}

function charOf(id) {
  return DEFS.CHARACTERS.find((c) => c.id === id) || DEFS.CHARACTERS[0];
}
function kartOf(id) {
  return DEFS.KARTS.find((k) => k.id === id) || DEFS.KARTS[0];
}
function avatarHtml(charId, sm) {
  const c = charOf(charId);
  return `<div class="avatar${sm ? ' sm' : ''}" style="background:${c.color}">${esc(c.name[0])}</div>`;
}
function emit(event, payload) {
  return new Promise((resolve) => {
    if (payload === undefined) socket.emit(event, resolve);
    else socket.emit(event, payload, resolve);
  });
}

/* ---------- 玩家設定畫面 ---------- */
function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem('mkb-profile') || '{}');
    if (saved.name) state.me.name = saved.name;
    if (charOf(saved.character).id === saved.character) state.me.character = saved.character;
    if (kartOf(saved.kart).id === saved.kart) state.me.kart = saved.kart;
  } catch (e) {
    /* ignore */
  }
}
function saveProfile() {
  try {
    localStorage.setItem('mkb-profile', JSON.stringify({ name: state.me.name, character: state.me.character, kart: state.me.kart }));
  } catch (e) {
    /* ignore */
  }
}

function renderPickers() {
  const cg = $('#char-grid');
  cg.innerHTML = '';
  for (const c of DEFS.CHARACTERS) {
    const d = el('div', 'pick' + (c.id === state.me.character ? ' selected' : ''));
    d.innerHTML = `${avatarHtml(c.id)}<div>${esc(c.name)}</div>`;
    d.onclick = () => {
      state.me.character = c.id;
      renderPickers();
    };
    cg.appendChild(d);
  }
  const kg = $('#kart-grid');
  kg.innerHTML = '';
  for (const k of DEFS.KARTS) {
    const d = el('div', 'pick' + (k.id === state.me.kart ? ' selected' : ''));
    d.innerHTML = `<div class="kart-emoji">${k.emoji}</div><div>${esc(k.name)}</div><div class="desc">${esc(k.desc)}</div>`;
    d.onclick = () => {
      state.me.kart = k.id;
      renderPickers();
    };
    kg.appendChild(d);
  }
}

$('#btn-enter').onclick = async () => {
  state.me.name = $('#in-name').value.trim() || '';
  saveProfile();
  const payload = { name: state.me.name, character: state.me.character, kart: state.me.kart };
  const res = state.entered ? await emit('profile:update', payload) : await emit('join', payload);
  if (res?.error) return toast(res.error);
  if (res.playerId) state.me.id = res.playerId;
  Object.assign(state.me, res.profile);
  state.entered = true;
  renderLobbyMe();
  showScreen('screen-lobby');
  socket.emit('rooms:list', renderRooms);
};

$('#btn-edit-profile').onclick = () => {
  $('#in-name').value = state.me.name;
  renderPickers();
  showScreen('screen-profile');
};

/* ---------- 大廳 ---------- */
function renderLobbyMe() {
  const c = charOf(state.me.character);
  const k = kartOf(state.me.kart);
  $('#lobby-me').innerHTML = `${avatarHtml(c.id, true)}<div>${esc(state.me.name)}<div class="small muted">${esc(c.name)} · ${k.emoji} ${esc(k.name)}</div></div>`;
}

function renderRooms(rooms) {
  const list = $('#room-list');
  list.innerHTML = '';
  if (!rooms || !rooms.length) {
    list.appendChild(el('div', 'empty', '目前沒有房間，開一間吧！'));
    return;
  }
  for (const r of rooms) {
    const row = el('div', 'room-row');
    const full = r.count >= r.maxPlayers;
    const playing = r.status !== 'waiting';
    row.innerHTML = `
      <div class="info">
        <div class="name">${esc(r.name)}</div>
        <div class="sub">房主 ${esc(r.hostName)} · ${r.laps} 圈 · ${r.count}/${r.maxPlayers} 人</div>
      </div>
      <span class="badge ${playing ? 'playing' : full ? 'warn' : 'ok'}">${playing ? '遊戲中' : full ? '已滿' : '等待中'}</span>`;
    const btn = el('button', 'btn small', '加入');
    btn.disabled = full || playing;
    btn.onclick = async () => {
      const res = await emit('room:join', r.id);
      if (res?.error) return toast(res.error);
      enterRoom(res.room);
    };
    row.appendChild(btn);
    list.appendChild(row);
  }
}
socket.on('rooms', renderRooms);
$('#btn-refresh').onclick = () => socket.emit('rooms:list', renderRooms);

$('#btn-open-create').onclick = () => {
  $('#in-room-name').value = `${state.me.name} 的房間`;
  $('#dlg-create').classList.remove('hidden');
};
$('#btn-cancel-create').onclick = () => $('#dlg-create').classList.add('hidden');
$('#btn-create').onclick = async () => {
  const res = await emit('room:create', { name: $('#in-room-name').value, laps: $('#in-room-laps').value, maxPlayers: $('#in-room-max').value });
  if (res?.error) return toast(res.error);
  $('#dlg-create').classList.add('hidden');
  enterRoom(res.room);
};

/* ---------- 房間 ---------- */
function enterRoom(room) {
  state.room = room;
  $('#room-chat-log').innerHTML = '';
  renderRoom();
  showScreen('screen-room');
}

function renderRoom() {
  const r = state.room;
  if (!r) return;
  const isHost = r.hostId === state.me.id;
  $('#room-title').textContent = r.name;
  $('#room-meta').textContent = `${r.laps} 圈 · ${r.players.length}/${r.maxPlayers} 人 · 房號 ${r.id}`;
  const list = $('#room-players');
  list.innerHTML = '';
  for (const p of r.players) {
    const c = charOf(p.character);
    const k = kartOf(p.kart);
    const row = el('div', 'player-row');
    row.innerHTML = `${avatarHtml(p.character, true)}
      <div class="info"><div class="name">${esc(p.name)}${p.id === state.me.id ? ' (你)' : ''}</div>
      <div class="sub">${esc(c.name)} · ${k.emoji} ${esc(k.name)}</div></div>
      ${p.isHost ? '<span class="badge warn">👑 房主</span>' : `<span class="badge ${p.ready ? 'ok' : ''}">${p.ready ? '✅ 已準備' : '等待中'}</span>`}`;
    list.appendChild(row);
  }
  for (let i = r.players.length; i < r.maxPlayers; i++) {
    list.appendChild(el('div', 'player-row muted', '<div class="info"><div class="sub">— 空位 —</div></div>'));
  }
  const me = r.players.find((p) => p.id === state.me.id);
  $('#room-host-settings').classList.toggle('hidden', !isHost);
  $('#in-set-laps').value = String(r.laps);
  $('#in-set-max').value = String(r.maxPlayers);
  $('#btn-ready').classList.toggle('hidden', isHost);
  $('#btn-ready').textContent = me?.ready ? '取消準備' : '✅ 準備';
  $('#btn-start').classList.toggle('hidden', !isHost);
  const allReady = r.players.every((p) => p.ready);
  $('#btn-start').disabled = !allReady;
  $('#room-hint').textContent = isHost
    ? allReady
      ? r.players.length === 1
        ? '可以單人試玩，或等朋友加入後再開始。'
        : '全員準備完成，可以開始！'
      : '等待所有玩家按下準備…'
    : me?.ready
      ? '等待房主開始遊戲…'
      : '按「準備」告訴房主你準備好了。';
}

socket.on('room:state', (room) => {
  const wasIn = !!state.room;
  state.room = room;
  renderRoom();
  if (!wasIn) showScreen('screen-room');
});

$('#btn-ready').onclick = () => {
  const me = state.room?.players.find((p) => p.id === state.me.id);
  socket.emit('room:ready', !me?.ready);
};
$('#btn-start').onclick = async () => {
  const res = await emit('room:start');
  if (res?.error) toast(res.error);
};
$('#in-set-laps').onchange = (e) => socket.emit('room:settings', { laps: e.target.value }, (r) => r?.error && toast(r.error));
$('#in-set-max').onchange = (e) => socket.emit('room:settings', { maxPlayers: e.target.value }, (r) => r?.error && toast(r.error));
$('#btn-leave-room').onclick = async () => {
  await emit('room:leave');
  state.room = null;
  showScreen('screen-lobby');
  socket.emit('rooms:list', renderRooms);
};

function bindChat(formId, inputId) {
  $(formId).onsubmit = (e) => {
    e.preventDefault();
    const inp = $(inputId);
    const text = inp.value.trim();
    if (text) socket.emit('chat', text);
    inp.value = '';
    inp.blur();
  };
}
bindChat('#room-chat-form', '#room-chat-input');
bindChat('#game-chat-form', '#game-chat-input');
socket.on('chat', (m) => {
  for (const id of ['#room-chat-log', '#game-chat-log']) {
    const log = $(id);
    const d = el('div', 'msg', `<b>${esc(m.from)}</b>：${esc(m.text)}`);
    log.appendChild(d);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  if (state.game && state.isMobile) toast(`${m.from}：${m.text}`, 2500);
});

/* ---------- 遊戲 ---------- */
function ensureScene() {
  if (!state.scene) state.scene = new KartScene($('#gl'));
  return state.scene;
}

function addLog(lines, fresh) {
  if (!lines || !lines.length) return;
  const log = $('#hud-log');
  for (const l of lines) {
    state.logLines.push(l);
    const d = el('div', 'line' + (fresh ? ' new' : ''), esc(l));
    log.appendChild(d);
  }
  while (log.children.length > 80) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
  setTimeout(() => log.querySelectorAll('.line.new').forEach((n) => n.classList.remove('new')), 2500);
}

function renderHelp() {
  $('#help-tiles').innerHTML = Object.entries(DEFS.TILE_INFO)
    .map(([, t]) => `<div class="legend"><div class="e">${t.emoji}</div><div><b>${esc(t.name)}</b>${esc(t.desc)}</div></div>`)
    .join('');
  $('#help-items').innerHTML = Object.values(DEFS.ITEMS)
    .map((t) => `<div class="legend"><div class="e">${t.emoji}</div><div><b>${esc(t.name)}</b>${esc(t.desc)}</div></div>`)
    .join('');
  $('#help-karts').innerHTML = DEFS.KARTS.map((k) => `<div class="legend"><div class="e">${k.emoji}</div><div><b>${esc(k.name)}</b>${esc(k.desc)}</div></div>`).join('');
}

function startGame(payload) {
  state.room = payload.room;
  state.game = payload.state;
  state.queue = [];
  state.busy = false;
  state.pendingOver = null;
  state.logLines = [];
  $('#hud-log').innerHTML = '';
  $('#game-chat-log').innerHTML = '';
  $('#dlg-result').classList.add('hidden');
  const scene = ensureScene();
  scene.setPlayers(state.game.players);
  scene.setBananas(state.game.bananas);
  scene.setCurrent(state.game.currentId);
  scene.setFollow(true);
  scene.focus(state.game.currentId);
  showScreen('screen-game');
  scene.resize();
  if (state.isMobile) {
    $('#hud-players').classList.add('collapsed');
    $('#hud-log').classList.remove('collapsed');
  } else {
    $('#hud-players').classList.remove('collapsed');
    $('#hud-log').classList.remove('collapsed');
  }
  addLog([`🚦 比賽開始！共 ${state.game.laps} 圈，${state.game.players.length} 位玩家`], true);
  renderHUD();
  startTimer();
}

function renderHUD() {
  const g = state.game;
  if (!g) return;
  const cur = g.players.find((p) => p.id === g.currentId);
  const mine = g.currentId === state.me.id;
  const info = $('#turn-info');
  if (g.finished) info.textContent = '比賽結束';
  else if (state.busy) info.textContent = '⏳ 移動中…';
  else if (mine) info.textContent = '🎯 你的回合！';
  else info.textContent = `輪到 ${cur?.name ?? '?'}`;
  info.classList.toggle('mine', mine && !state.busy && !g.finished);

  // 玩家面板
  const panel = $('#hud-players');
  panel.innerHTML = '';
  const sorted = [...g.players].sort((a, b) => a.standing - b.standing);
  for (const p of sorted) {
    const row = el('div', 'hp-row' + (p.id === g.currentId ? ' current' : '') + (p.id === state.me.id ? ' me' : '') + (p.finished ? ' done' : '') + (p.dropped ? ' dropped' : ''));
    const status = [];
    if (p.finished) status.push(`🏁 第 ${p.rank} 名`);
    else status.push(`第 ${p.lap + 1} 圈 · 第 ${p.tile} 格`);
    if (p.starTurns > 0) status.push('⭐ 無敵');
    if (p.skipTurn) status.push('💫 暫停');
    row.innerHTML = `<div class="rank">${p.standing}</div>${avatarHtml(p.character, true)}
      <div class="info"><div class="name">${esc(p.name)}</div><div class="sub">${status.join(' · ')}</div></div>
      <div class="its">${p.items.map((i) => DEFS.ITEMS[i].emoji).join('')}</div>`;
    panel.appendChild(row);
  }

  // 我的道具
  const me = g.players.find((p) => p.id === state.me.id);
  const items = $('#my-items');
  items.innerHTML = '';
  const canAct = mine && !state.busy && !g.finished && me && !me.finished;
  for (let i = 0; i < DEFS.MAX_ITEMS; i++) {
    const it = me?.items[i];
    const slot = el('div', 'item-slot' + (it ? (canAct && !g.usedItemThisTurn ? ' usable' : '') : ' empty'));
    slot.textContent = it ? DEFS.ITEMS[it].emoji : '·';
    slot.title = it ? `${DEFS.ITEMS[it].name}：${DEFS.ITEMS[it].desc}` : '空的道具欄';
    if (it) {
      slot.onclick = async () => {
        if (!canAct) return toast('現在不能使用道具');
        if (g.usedItemThisTurn) return toast('這回合已經用過道具了');
        if (!confirm(`使用 ${DEFS.ITEMS[it].emoji} ${DEFS.ITEMS[it].name}？\n${DEFS.ITEMS[it].desc}`)) return;
        const res = await emit('game:useItem', { slot: i });
        if (res?.error) toast(res.error);
      };
    }
    items.appendChild(slot);
  }
  $('#btn-roll').disabled = !canAct;
}

function startTimer() {
  clearInterval(state.timerHandle);
  state.timerHandle = setInterval(() => {
    const g = state.game;
    const t = $('#turn-timer');
    if (!g || g.finished) {
      t.textContent = '';
      return;
    }
    const left = Math.max(0, Math.ceil((g.turnDeadline - Date.now()) / 1000));
    t.textContent = `⏱ ${left}s`;
    t.classList.toggle('urgent', left <= 10);
  }, 500);
}

async function rollDice(die, bonus) {
  const d = $('#dice');
  d.classList.add('rolling');
  d.classList.remove('bonus');
  const start = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      d.textContent = String(1 + Math.floor(Math.random() * 6));
      if (performance.now() - start < 800) setTimeout(tick, 70);
      else resolve();
    };
    tick();
  });
  d.classList.remove('rolling');
  d.textContent = String(die);
  if (bonus) {
    await new Promise((r) => setTimeout(r, 350));
    d.textContent = `${die}+${bonus}`;
    d.classList.add('bonus');
  }
  await new Promise((r) => setTimeout(r, 400));
}

const MOVE_LABEL = {
  roll: '前進',
  boost: '🔥 加速',
  mushroom: '🍄 衝刺',
  bump: '💥 被撞退',
  banana: '🍌 滑倒',
  green: '🐢 被綠殼擊中',
  red: '🔴 被紅殼擊中',
  blue: '🔵 被藍殼擊中',
  lightning: '⚡ 被閃電擊中',
};

async function handleAction(ev) {
  const scene = ensureScene();
  state.busy = true;
  renderHUD();
  const actor = state.game?.players.find((p) => p.id === ev.playerId);
  scene.focus(ev.playerId);
  if (ev.kind === 'roll') {
    addLog([ev.log[0]], true);
    await rollDice(ev.die, ev.bonus);
  } else if (ev.kind === 'item') {
    addLog([ev.log[0]], true);
    toast(`${actor?.name ?? ''} 使用了 ${DEFS.ITEMS[ev.item]?.emoji ?? ''} ${DEFS.ITEMS[ev.item]?.name ?? ''}`);
    await new Promise((r) => setTimeout(r, 500));
    if (ev.bananaPlaced !== undefined) scene.setBananas(ev.state.bananas);
  } else if (ev.kind === 'leave') {
    addLog([ev.log[0]], true);
  }
  for (const m of ev.moves) {
    scene.focus(m.playerId);
    const who = state.game?.players.find((p) => p.id === m.playerId);
    const label = MOVE_LABEL[m.kind] || m.kind;
    if (m.kind !== 'roll') addLog([`${who?.name ?? ''} ${label}（${m.from} → ${m.to}）`]);
    await scene.animateMove(m.playerId, m.from, m.to, m.kind);
  }
  addLog(ev.log.slice(1));
  if (ev.gains?.length) {
    for (const gi of ev.gains) if (gi.playerId === state.me.id) toast(`你獲得 ${DEFS.ITEMS[gi.item].emoji} ${DEFS.ITEMS[gi.item].name}`);
  }
  state.game = ev.state;
  scene.setBananas(ev.state.bananas);
  for (const p of ev.state.players) if (p.dropped) scene.removeKart(p.id);
  scene.setCurrent(ev.state.currentId);
  if (ev.state.currentId) scene.focus(ev.state.currentId);
  if (ev.state.currentId === state.me.id && !ev.state.finished) {
    toast('🎯 輪到你了！', 1500);
    if (navigator.vibrate) navigator.vibrate(80);
  }
  state.busy = false;
  renderHUD();
}

async function pump() {
  if (state.busy) return;
  while (state.queue.length) {
    const ev = state.queue.shift();
    try {
      await handleAction(ev);
    } catch (e) {
      console.error(e);
      state.busy = false;
    }
  }
  if (state.pendingOver) {
    const over = state.pendingOver;
    state.pendingOver = null;
    showResult(over);
  }
}

socket.on('game:start', startGame);
socket.on('game:action', (ev) => {
  if (!state.game) return;
  state.queue.push(ev);
  pump();
});
socket.on('game:over', (payload) => {
  state.pendingOver = payload;
  pump();
});

function showResult(payload) {
  const list = $('#result-list');
  list.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];
  const players = [...payload.result.players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  players.forEach((p, i) => {
    const row = el('div', 'result-row');
    row.innerHTML = `<div class="medal">${p.dropped && !p.rank ? '🚪' : medals[i] || `${p.rank}.`}</div>${avatarHtml(p.character, true)}
      <div class="name">${esc(p.name)}${p.id === state.me.id ? ' (你)' : ''}</div>
      <div class="muted small">${p.dropped ? '離開' : `${p.rank} 名`}</div>`;
    list.appendChild(row);
  });
  state.room = payload.room;
  $('#dlg-result').classList.remove('hidden');
}
$('#btn-result-close').onclick = () => {
  $('#dlg-result').classList.add('hidden');
  state.game = null;
  clearInterval(state.timerHandle);
  state.scene?.setCurrent(null);
  renderRoom();
  showScreen('screen-room');
};

$('#btn-roll').onclick = async () => {
  $('#btn-roll').disabled = true;
  const res = await emit('game:roll');
  if (res?.error) {
    toast(res.error);
    renderHUD();
  }
};
$('#btn-toggle-players').onclick = () => {
  $('#hud-players').classList.toggle('collapsed');
  if (state.isMobile && !$('#hud-players').classList.contains('collapsed')) $('#hud-log').classList.add('collapsed');
};
$('#btn-toggle-log').onclick = () => {
  const log = $('#hud-log');
  log.classList.toggle('collapsed');
  if (state.isMobile) {
    if (!log.classList.contains('collapsed')) $('#hud-players').classList.add('collapsed');
    $('#chat-overlay').classList.toggle('open', !log.classList.contains('collapsed'));
  }
};
let camMode = 0;
$('#btn-camera').onclick = () => {
  const scene = ensureScene();
  camMode = (camMode + 1) % 3;
  if (camMode === 0) {
    scene.setFollow(true);
    scene.focus(state.game?.currentId);
    toast('🎥 跟隨目前玩家');
  } else if (camMode === 1) {
    scene.setFollow(true);
    scene.focus(state.me.id);
    toast('🎥 跟隨自己');
  } else {
    scene.overview();
    toast('🎥 全景（可拖曳旋轉）');
  }
};
$('#btn-help').onclick = () => $('#hud-help').classList.toggle('hidden');
$('#btn-help-close').onclick = () => $('#hud-help').classList.add('hidden');
$('#btn-quit').onclick = async () => {
  if (!confirm('確定要離開比賽嗎？你會被判定退出。')) return;
  await emit('room:leave');
  state.game = null;
  state.room = null;
  clearInterval(state.timerHandle);
  state.scene?.setCurrent(null);
  showScreen('screen-lobby');
  socket.emit('rooms:list', renderRooms);
};

/* ---------- 連線 ---------- */
socket.on('connect', () => {
  $('#conn-status').textContent = '已連線到伺服器';
  if (state.entered) {
    // 伺服器重啟或斷線重連：重新註冊並回到大廳
    socket.emit('join', { name: state.me.name, character: state.me.character, kart: state.me.kart }, (res) => {
      if (res?.playerId) state.me.id = res.playerId;
      if (state.room || state.game) {
        state.room = null;
        state.game = null;
        clearInterval(state.timerHandle);
        state.scene?.setCurrent(null);
        showScreen('screen-lobby');
        toast('連線曾中斷，已回到大廳，請重新加入房間', 3500);
      }
      socket.emit('rooms:list', renderRooms);
    });
  }
});
socket.on('disconnect', () => {
  $('#conn-status').textContent = '與伺服器斷線，重新連線中…';
  if (state.entered) toast('與伺服器斷線，重新連線中…', 3000);
});
socket.on('connect_error', () => {
  $('#conn-status').textContent = '無法連線到伺服器，重試中…';
});

/* ---------- 啟動 ---------- */
loadProfile();
$('#in-name').value = state.me.name;
renderPickers();
renderHelp();
window.addEventListener('beforeunload', (e) => {
  if (state.game) {
    e.preventDefault();
    e.returnValue = '';
  }
});
