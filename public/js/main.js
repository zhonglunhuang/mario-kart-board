import { RaceScene } from './scene.js';
import { loadAssets, assets } from './models.js';
import { audio } from './audio.js';
import { VoiceChat } from './voice.js';
import { RaceController } from './race.js';

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
  scene: null,
  race: null,
  createMap: DEFS.DEFAULT_MAP,
  voice: null,
  config: {},
  get isMobile() {
    return window.matchMedia('(max-width: 720px)').matches;
  },
  get isTouch() {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
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
function mapOf(id) {
  return DEFS.MAPS[id] || DEFS.MAPS[DEFS.DEFAULT_MAP];
}
function mapLabel(id) {
  const m = mapOf(id);
  return `${m.emoji} ${m.name}`;
}
function renderMapGrid() {
  const g = $('#map-grid');
  g.innerHTML = '';
  for (const m of Object.values(DEFS.MAPS)) {
    const d = el('div', 'pick map' + (m.id === state.createMap ? ' selected' : ''));
    d.innerHTML = `<div class="kart-emoji">${m.emoji}</div><div>${esc(m.name)}</div><div class="desc">${'★'.repeat(m.difficulty)}${'☆'.repeat(3 - m.difficulty)}<br>${esc(m.desc)}</div>`;
    d.onclick = () => {
      state.createMap = m.id;
      renderMapGrid();
    };
    g.appendChild(d);
  }
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
function fmtTime(ms) {
  if (ms == null) return '--';
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

/* ---------- 玩家設定 ---------- */
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

function statBar(v, max) {
  const pct = Math.round((v / max) * 100);
  return `<span class="bar"><i style="width:${pct}%"></i></span>`;
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
    d.innerHTML = `<div class="kart-emoji">${k.emoji}</div><div>${esc(k.name)}</div>
      <div class="stats"><div>極速 ${statBar(k.maxSpeed, 50)}</div><div>加速 ${statBar(k.accel, 27)}</div><div>轉向 ${statBar(k.turn, 2.8)}</div><div>越野 ${statBar(k.offroad, 1)}</div></div>
      <div class="desc">${esc(k.desc)}</div>`;
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
        <div class="sub">${mapLabel(r.map)} · ${r.laps} 圈 · ${r.count}/${r.maxPlayers} 人 · 房主 ${esc(r.hostName)}</div>
      </div>
      <span class="badge ${playing ? 'playing' : full ? 'warn' : 'ok'}">${playing ? '比賽中' : full ? '已滿' : '等待中'}</span>`;
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
  renderMapGrid();
  $('#dlg-create').classList.remove('hidden');
};
$('#btn-cancel-create').onclick = () => $('#dlg-create').classList.add('hidden');
$('#btn-create').onclick = async () => {
  const res = await emit('room:create', { name: $('#in-room-name').value, laps: $('#in-room-laps').value, maxPlayers: $('#in-room-max').value, map: state.createMap, bots: $('#in-room-bots').value, difficulty: $('#in-room-diff').value });
  if (res?.error) return toast(res.error);
  $('#dlg-create').classList.add('hidden');
  enterRoom(res.room);
};

/* ---------- 房間 ---------- */
function enterRoom(room) {
  state.room = room;
  preloadAssets().catch(() => {});
  $('#room-chat-log').innerHTML = '';
  renderRoom();
  showScreen('screen-room');
}
function renderRoom() {
  const r = state.room;
  if (!r) return;
  const isHost = r.hostId === state.me.id;
  $('#room-title').textContent = r.name;
  const v = r.variant || {};
  const vtxt = [v.reverse ? '逆向' : '', v.mirror ? '鏡像' : '', v.time && v.time !== 'auto' ? DEFS.VARIANTS.time.find((x) => x.id === v.time)?.name : '', v.weather && v.weather !== 'auto' ? DEFS.VARIANTS.weather.find((x) => x.id === v.weather)?.name : ''].filter(Boolean).join(' ');
  $('#room-meta').textContent = `${mapLabel(r.map)}${vtxt ? ' (' + vtxt + ')' : ''} · ${r.laps} 圈 · ${r.players.length}/${r.maxPlayers} 人 · 🤖${r.bots ?? 0}（${DEFS.DIFFICULTIES.find((d) => d.id === r.difficulty)?.name || '普通'}）· 房號 ${r.id}`;
  const voiceSet = new Set(r.voice || []);
  const list = $('#room-players');
  list.innerHTML = '';
  for (const p of r.players) {
    const c = charOf(p.character);
    const k = kartOf(p.kart);
    const row = el('div', 'player-row');
    row.innerHTML = `${avatarHtml(p.character, true)}
      <div class="info"><div class="name">${esc(p.name)}${p.id === state.me.id ? ' (你)' : ''}${voiceSet.has(p.id) ? ' 🎤' : ''}</div>
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
  $('#in-set-map').value = r.map || DEFS.DEFAULT_MAP;
  $('#in-set-bots').value = String(r.bots ?? 0);
  $('#in-set-diff').value = r.difficulty || 'normal';
  $('#in-set-time').value = v.time || 'auto';
  $('#in-set-weather').value = v.weather || 'auto';
  $('#in-set-reverse').checked = !!v.reverse;
  $('#in-set-mirror').checked = !!v.mirror;
  renderVoiceUI();
  $('#btn-ready').classList.toggle('hidden', isHost);
  $('#btn-ready').textContent = me?.ready ? '取消準備' : '✅ 準備';
  $('#btn-start').classList.toggle('hidden', !isHost);
  const allReady = r.players.every((p) => p.ready);
  $('#btn-start').disabled = !allReady;
  $('#room-hint').textContent = isHost
    ? allReady
      ? r.players.length === 1
        ? '可以單人練習，或等朋友加入後再開始。'
        : '全員準備完成，可以開始！'
      : '等待所有玩家按下準備…'
    : me?.ready
      ? '等待房主開始比賽…'
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
$('#in-set-map').onchange = (e) => socket.emit('room:settings', { map: e.target.value }, (r) => r?.error && toast(r.error));
$('#in-set-bots').onchange = (e) => socket.emit('room:settings', { bots: e.target.value }, (r) => r?.error && toast(r.error));
$('#in-set-diff').onchange = (e) => socket.emit('room:settings', { difficulty: e.target.value }, (r) => r?.error && toast(r.error));
$('#in-set-time').onchange = (e) => socket.emit('room:settings', { variant: { time: e.target.value } }, (r) => r?.error && toast(r.error));
$('#in-set-weather').onchange = (e) => socket.emit('room:settings', { variant: { weather: e.target.value } }, (r) => r?.error && toast(r.error));
$('#in-set-reverse').onchange = (e) => socket.emit('room:settings', { variant: { reverse: e.target.checked } }, (r) => r?.error && toast(r.error));
$('#in-set-mirror').onchange = (e) => socket.emit('room:settings', { variant: { mirror: e.target.checked } }, (r) => r?.error && toast(r.error));
$('#btn-leave-room').onclick = async () => {
  state.voice?.leave();
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
  if (state.race) toast(`${m.from}：${m.text}`, 2500);
});

/* ---------- 比賽 ---------- */
/* ---------- 啟動畫面 / 模型預載 ---------- */
const splash = {
  status(text) {
    const el = $('#splash-status');
    if (el) el.textContent = text;
  },
  bar(p) {
    const el = $('#splash-bar');
    if (el) el.style.width = `${Math.round(p * 100)}%`;
  },
  hide() {
    const el = $('#splash');
    if (el) el.style.display = 'none';
    clearTimeout(window.__splashTimer);
  },
};
let assetProgress = 0;
function preloadAssets() {
  return loadAssets((p) => {
    assetProgress = p;
    const bar = $('#asset-bar');
    if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    const txt = $('#asset-progress-text');
    if (txt) txt.textContent = `3D 模型載入中 ${Math.round(p * 100)}%`;
    const lb = $('#load-bar');
    if (lb) lb.style.width = `${Math.round(p * 100)}%`;
    if (p >= 1) setTimeout(() => $('#asset-progress').classList.add('hidden'), 800);
  }).catch((e) => {
    console.error('模型載入失敗', e);
    toast('3D 模型載入失敗，請重新整理', 4000);
    throw e;
  });
}
let scenePromise = null;
let scenePromiseKey = null;
function getQuality() {
  try {
    const q = localStorage.getItem('mkb-quality');
    if (q) return q;
  } catch (e) {
    /* ignore */
  }
  return state.isMobile || state.isTouch ? 'medium' : 'high';
}
function ensureScene(mapId = DEFS.DEFAULT_MAP, variant = {}) {
  const quality = getQuality();
  const key = JSON.stringify([mapId, variant, quality]);
  if (scenePromise && scenePromiseKey === key) return scenePromise;
  if (!assets.ready) $('#asset-progress').classList.remove('hidden');
  scenePromiseKey = key;
  scenePromise = preloadAssets()
    .then(() => {
      if (state.scene) {
        state.scene.dispose();
        state.scene = null;
      }
      return RaceScene.create($('#gl'), { mobile: state.isMobile, map: mapId, variant, quality });
    })
    .then((scene) => {
      state.scene = scene;
      return scene;
    })
    .catch((e) => {
      scenePromise = null;
      toast('無法初始化 3D 畫面：' + (e?.message || e), 5000);
      throw e;
    });
  return scenePromise;
}

async function startGame(payload) {
  state.room = payload.room;
  $('#dlg-result').classList.add('hidden');
  $('#game-chat-log').innerHTML = '';
  $('#hud-help').classList.add('hidden');
  $('#chat-overlay').classList.toggle('open', !state.isTouch && !state.isMobile);
  const mapId = payload.state.map || payload.room.map || DEFS.DEFAULT_MAP;
  const variant = payload.state.variant || payload.room.variant || {};
  $('#dlg-loading').classList.remove('hidden');
  const scene = await ensureScene(mapId, variant);
  $('#dlg-loading').classList.add('hidden');
  if (state.race) state.race.destroy();
  showScreen('screen-game');
  scene.resize();
  audio.unlock();
  audio.engineStart();
  let joystick = true;
  try { joystick = localStorage.getItem('mkb-joystick') !== '0'; } catch (e) { /* ignore */ }
  state.race = new RaceController({ scene, socket, meId: state.me.id, state: payload.state, room: payload.room, isTouch: state.isTouch, audio, prefs: { joystick } });
  renderVoiceUI();
  if (state.isTouch) {
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch (e) { /* iOS 不支援 */ }
    checkOrientation();
  }
}
socket.on('game:start', startGame);
socket.on('race:snapshot', (snap) => state.race?.onSnapshot(snap));
socket.on('race:event', (ev) => state.race?.onEvent(ev));
socket.on('game:over', (payload) => {
  showResult(payload);
});

function showResult(payload) {
  const list = $('#result-list');
  list.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];
  const players = [...payload.result.players].filter((p) => !p.dropped || p.rank).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  players.forEach((p, i) => {
    const row = el('div', 'result-row');
    row.innerHTML = `<div class="medal">${medals[i] || `${p.rank ?? '-'}.`}</div>${avatarHtml(p.character, true)}
      <div class="name">${esc(p.name)}${p.id === state.me.id ? ' (你)' : ''}</div>
      <div class="muted small">${p.finishTime != null ? fmtTime(p.finishTime) : '未完賽'}</div>`;
    list.appendChild(row);
  });
  state.room = payload.room;
  $('#dlg-result').classList.remove('hidden');
}
let rotateSkipped = false;
function checkOrientation() {
  const hint = $('#rotate-hint');
  const portrait = window.innerHeight > window.innerWidth;
  hint.classList.toggle('hidden', !(state.race && state.isTouch && portrait && !rotateSkipped));
}
window.addEventListener('resize', checkOrientation);
$('#btn-rotate-skip').onclick = () => {
  rotateSkipped = true;
  checkOrientation();
};
function leaveRaceView() {
  $('#dlg-result').classList.add('hidden');
  try { screen.orientation?.unlock?.(); } catch (e) { /* ignore */ }
  $('#rotate-hint').classList.add('hidden');
  audio.music('lobby');
  if (state.race) {
    state.race.destroy();
    state.race = null;
  }
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
$('#btn-result-close').onclick = () => {
  leaveRaceView();
  renderRoom();
  showScreen('screen-room');
};
$('#btn-help').onclick = () => $('#hud-help').classList.toggle('hidden');
$('#btn-help-close').onclick = () => $('#hud-help').classList.add('hidden');
$('#btn-chat').onclick = () => $('#chat-overlay').classList.toggle('open');
$('#btn-quit').onclick = async () => {
  if (!confirm('確定要退出比賽嗎？')) return;
  state.voice?.leave();
  await emit('room:leave');
  leaveRaceView();
  state.room = null;
  showScreen('screen-lobby');
  socket.emit('rooms:list', renderRooms);
};

/* ---------- 音效 / 語音 ---------- */
function renderAudioUI() {
  for (const b of document.querySelectorAll('.btn-mute')) b.textContent = audio.muted ? '🔇' : '🔊';
  const v = $('#btn-announcer');
  if (v) v.textContent = `播報：${audio.voiceOn ? '開' : '關'}`;
}
for (const b of document.querySelectorAll('.btn-mute')) {
  b.onclick = () => {
    audio.unlock();
    audio.setMuted(!audio.muted);
    renderAudioUI();
  };
}
$('#sel-quality').value = getQuality();
$('#sel-quality').onchange = (e) => {
  try { localStorage.setItem('mkb-quality', e.target.value); } catch (err) { /* ignore */ }
  toast('畫質設定會在下一場比賽生效');
};
$('#btn-music').onclick = () => {
  audio.unlock();
  audio.setMusic(!audio.musicOn);
  $('#btn-music').textContent = `音樂：${audio.musicOn ? '開' : '關'}`;
};
$('#btn-music').textContent = `音樂：${audio.musicOn ? '開' : '關'}`;
$('#btn-announcer').onclick = () => {
  audio.setVoice(!audio.voiceOn);
  renderAudioUI();
  if (audio.voiceOn) audio.say('播報已開啟');
};
document.addEventListener('pointerdown', () => { audio.unlock(); if (!state.race) audio.music('lobby'); }, { once: true });

state.voice = new VoiceChat(socket, { onState: () => renderVoiceUI() });
function renderVoiceUI() {
  const st = state.voice.status();
  const ok = state.voice.supported && state.voice.secure;
  for (const b of document.querySelectorAll('.btn-voice')) {
    b.disabled = !ok;
    b.title = ok ? '' : '語音需要 HTTPS 網址';
    b.textContent = !ok ? '🎤 語音需 HTTPS' : !st.joined ? '🎤 加入語音' : st.muted ? '🔇 已靜音（點擊開麥）' : `🎙️ 開麥中（${st.connected}/${st.peers} 人連線）`;
    b.classList.toggle('live', st.joined && !st.muted);
  }
  for (const b of document.querySelectorAll('.btn-voice-leave')) b.classList.toggle('hidden', !st.joined);
  const mic = $('#btn-mic');
  if (mic) {
    mic.textContent = !st.joined ? '🎤' : st.muted ? '🔇' : '🎙️';
    mic.classList.toggle('live', st.joined && !st.muted);
    mic.disabled = !ok;
  }
  const hint = $('#https-hint');
  if (hint) hint.classList.toggle('hidden', ok || !state.config.httpsUrl);
}
async function toggleVoice() {
  audio.unlock();
  try {
    if (!state.voice.joined) {
      await state.voice.join();
      toast('🎙️ 已加入語音，房間裡的人可以聽到你');
    } else {
      state.voice.setMuted(!state.voice.muted);
    }
  } catch (e) {
    toast(e?.message || '無法開啟麥克風', 4000);
  }
  renderVoiceUI();
}
for (const b of document.querySelectorAll('.btn-voice')) b.onclick = toggleVoice;
for (const b of document.querySelectorAll('.btn-voice-leave')) b.onclick = () => state.voice.leave();
$('#btn-mic').onclick = toggleVoice;
fetch(`${BASE}/config`)
  .then((r) => r.json())
  .then((c) => {
    state.config = c || {};
    const a = $('#https-link');
    if (a && c.httpsUrl) a.href = c.httpsUrl;
    renderVoiceUI();
  })
  .catch(() => {});

/* ---------- 連線 ---------- */
socket.on('connect', () => {
  $('#conn-status').textContent = '已連線到伺服器';
  splash.status('已連線，準備完成');
  splash.bar(1);
  setTimeout(() => splash.hide(), 150);
  if (state.entered) {
    socket.emit('join', { name: state.me.name, character: state.me.character, kart: state.me.kart }, (res) => {
      if (res?.playerId) state.me.id = res.playerId;
      if (state.room || state.race) {
        leaveRaceView();
        state.room = null;
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
  splash.status('無法連線到伺服器，重試中…');
});

/* ---------- 啟動 ---------- */
window.__debug = { state, DEFS };
splash.status('連線伺服器…');
splash.bar(0.6);
// 5 秒內沒連上也先讓玩家看到畫面（之後會自動重連）
setTimeout(() => splash.hide(), 5000);
// 進到大廳後就在背景預載 3D 模型，開始比賽時就不用等
const startPreload = () => {
  $('#asset-progress').classList.remove('hidden');
  preloadAssets().catch(() => {});
};
$('#btn-enter').addEventListener('click', startPreload, { once: true });
loadProfile();
$('#in-name').value = state.me.name;
renderPickers();
renderAudioUI();
renderVoiceUI();
window.addEventListener('beforeunload', (e) => {
  if (state.race) {
    e.preventDefault();
    e.returnValue = '';
  }
});
