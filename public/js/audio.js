/* 音效：Kenney CC0 取樣（撞擊 / 介面）＋ WebAudio 合成（引擎多層、漂移、加速、爆炸）＋ 程序化背景音樂 ＋ TTS 播報 */

const SAMPLES = {
  wallHeavy: ['audio/impactMetal_heavy_000.ogg', 'audio/impactMetal_heavy_001.ogg'],
  wallLight: ['audio/impactMetal_light_000.ogg', 'audio/impactMetal_light_001.ogg'],
  bump: ['audio/impactGeneric_light_000.ogg', 'audio/impactGeneric_light_001.ogg'],
  box: ['audio/impactGlass_medium_000.ogg'],
  shellHit: ['audio/impactGlass_heavy_000.ogg'],
  bell: ['audio/impactBell_heavy_000.ogg'],
  pickup: ['audio/confirmation_001.ogg'],
  itemGet: ['audio/confirmation_002.ogg'],
  click: ['audio/click_001.ogg'],
  drop: ['audio/drop_001.ogg'],
  error: ['audio/error_004.ogg'],
  glass: ['audio/glass_002.ogg'],
  bong: ['audio/bong_001.ogg'],
};

const MUSIC = {
  // 每張譜：bpm、bass 音序（半音，相對 A2）、lead 音序（相對 A4），-1 = 休止
  race: { bpm: 128, bass: [0, 0, 7, 0, 5, 5, 3, 5, 0, 0, 7, 0, 8, 8, 7, 5], lead: [12, 16, 19, 16, 12, 16, 19, 23, 14, 17, 21, 17, 14, 17, 21, 24, 12, 16, 19, 16, 12, 16, 19, 23, 15, 19, 22, 19, 15, 19, 22, 27] },
  final: { bpm: 150, bass: [0, 0, 7, 0, 5, 5, 3, 5, 0, 0, 7, 0, 8, 8, 7, 5], lead: [12, 16, 19, 16, 12, 16, 19, 23, 14, 17, 21, 17, 14, 17, 21, 24, 12, 16, 19, 16, 12, 16, 19, 23, 15, 19, 22, 19, 15, 19, 22, 27] },
  lobby: { bpm: 96, bass: [0, -1, 5, -1, 7, -1, 5, -1], lead: [12, -1, 16, -1, 19, 16, -1, 14, 12, -1, 16, -1, 19, 21, -1, 19] },
  finish: { bpm: 110, bass: [0, 0, 5, 5, 7, 7, 12, 12], lead: [12, 16, 19, 24, 19, 16, 12, -1, 14, 17, 21, 26, 21, 17, 14, -1] },
};

class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.muted = false;
    this.voiceOn = true;
    this.musicOn = true;
    try {
      this.muted = localStorage.getItem('mkb-muted') === '1';
      this.voiceOn = localStorage.getItem('mkb-voice') !== '0';
      this.musicOn = localStorage.getItem('mkb-music') !== '0';
    } catch (e) {
      /* ignore */
    }
    this.buffers = new Map();
    this.engine = null;
    this.skid = null;
    this.starLoop = null;
    this.musicTimer = null;
    this.musicKey = null;
    this.musicStep = 0;
    this.musicNext = 0;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.32 : 0;
    this.musicBus.connect(this.master);
    const b = this.ctx.createBuffer(1, 1, 22050);
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.ctx.destination);
    s.start(0);
    if (window.speechSynthesis) window.speechSynthesis.getVoices();
    this.preload();
  }

  async preload() {
    const jobs = [];
    for (const [key, urls] of Object.entries(SAMPLES)) {
      for (const url of urls) {
        jobs.push(
          fetch(url)
            .then((r) => r.arrayBuffer())
            .then((ab) => this.ctx.decodeAudioData(ab))
            .then((buf) => {
              if (!this.buffers.has(key)) this.buffers.set(key, []);
              this.buffers.get(key).push(buf);
            })
            .catch(() => {}),
        );
      }
    }
    await Promise.all(jobs);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.7;
    try { localStorage.setItem('mkb-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (m && window.speechSynthesis) window.speechSynthesis.cancel();
  }
  setVoice(on) {
    this.voiceOn = on;
    try { localStorage.setItem('mkb-voice', on ? '1' : '0'); } catch (e) { /* ignore */ }
  }
  setMusic(on) {
    this.musicOn = on;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.2);
    try { localStorage.setItem('mkb-music', on ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  /* ---------- 取樣 ---------- */
  play(key, { gain = 1, rate = 1, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return false;
    const list = this.buffers.get(key);
    if (!list || !list.length) return false;
    const buf = list[Math.floor(Math.random() * list.length)];
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(this.sfxBus);
    s.start(this.ctx.currentTime + delay);
    return true;
  }

  /* ---------- 合成 ---------- */
  tone(freq, dur, { type = 'square', gain = 0.25, attack = 0.005, decay = dur, slide = 0, delay = 0, bus = null } = {}) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    o.connect(g).connect(bus || this.sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  noise(dur, { gain = 0.3, freq = 800, q = 0.7, delay = 0, type = 'bandpass' } = {}) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t0);
  }

  /* ---------- 遊戲音效 ---------- */
  countdownBeep(n) {
    this.tone(n === 0 ? 880 : 440, n === 0 ? 0.6 : 0.18, { type: 'square', gain: 0.3 });
    if (n === 0) this.tone(1320, 0.5, { type: 'square', gain: 0.15, delay: 0.05 });
  }
  pickup() {
    if (!this.play('box', { gain: 0.6, rate: 1.4 })) this.noise(0.2, { gain: 0.3, freq: 2500 });
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', gain: 0.2, delay: i * 0.06 }));
  }
  roulette() {
    for (let i = 0; i < 12; i++) this.tone(600 + (i % 3) * 120, 0.05, { type: 'square', gain: 0.08, delay: i * 0.1 });
  }
  itemGet() {
    if (!this.play('itemGet', { gain: 0.8 })) [784, 988, 1175].forEach((f, i) => this.tone(f, 0.16, { type: 'square', gain: 0.2, delay: i * 0.09 }));
  }
  useItem(item) {
    if (item === 'mushroom' || item === 'golden') this.boost();
    else if (item === 'star') this.starStart();
    else if (item === 'lightning') this.thunder();
    else if (item === 'banana') this.play('drop', { gain: 0.7 });
    else this.whoosh();
  }
  whoosh() {
    this.noise(0.3, { gain: 0.45, freq: 1500, q: 0.4 });
  }
  boost() {
    this.tone(220, 0.55, { type: 'sawtooth', gain: 0.28, slide: 900 });
    this.noise(0.4, { gain: 0.25, freq: 3000, q: 0.3 });
  }
  thunder() {
    this.noise(0.9, { gain: 0.7, freq: 300, q: 0.2, type: 'lowpass' });
    this.noise(0.3, { gain: 0.5, freq: 4000, q: 0.3 });
  }
  explode() {
    this.noise(0.8, { gain: 0.9, freq: 200, q: 0.3, type: 'lowpass' });
    this.tone(90, 0.7, { type: 'sine', gain: 0.5, slide: -60 });
    this.play('wallHeavy', { gain: 0.6, rate: 0.6 });
  }
  hit() {
    if (!this.play('shellHit', { gain: 0.9 })) this.noise(0.5, { gain: 0.6, freq: 400, q: 0.5 });
    this.tone(200, 0.5, { type: 'sawtooth', gain: 0.3, slide: -150 });
  }
  shellHit() {
    this.play('shellHit', { gain: 0.6 });
  }
  bump(strength = 8) {
    if (!this.play('bump', { gain: Math.min(1, 0.3 + strength / 20) })) this.noise(0.12, { gain: 0.35, freq: 600 });
  }
  wall(strength = 8) {
    const heavy = strength > 14;
    if (!this.play(heavy ? 'wallHeavy' : 'wallLight', { gain: Math.min(1, 0.4 + strength / 30) })) this.noise(0.2, { gain: 0.4, freq: 300 });
  }
  jump() {
    this.tone(300, 0.25, { type: 'triangle', gain: 0.25, slide: 500 });
  }
  land(impact) {
    this.noise(0.18, { gain: Math.min(0.6, impact / 25), freq: 250, q: 0.5, type: 'lowpass' });
    if (impact > 12) this.play('bump', { gain: 0.5, rate: 0.7 });
  }
  lap() {
    if (!this.play('bell', { gain: 0.5, rate: 1.3 })) [659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, { type: 'triangle', gain: 0.25, delay: i * 0.12 }));
  }
  finish(rank) {
    const notes = rank === 1 ? [523, 659, 784, 1047, 784, 1047] : [392, 494, 587, 784];
    notes.forEach((f, i) => this.tone(f, 0.25, { type: 'square', gain: 0.22, delay: i * 0.15 }));
  }
  click() {
    if (!this.play('click', { gain: 0.5 })) this.tone(700, 0.05, { type: 'square', gain: 0.12 });
  }
  driftLevel(level) {
    const f = [0, 660, 880, 1175][level] || 660;
    this.tone(f, 0.12, { type: 'square', gain: 0.22 });
    this.tone(f * 1.5, 0.12, { type: 'square', gain: 0.15, delay: 0.07 });
  }

  skidStart() {
    if (!this.ctx || this.skid) return;
    const len = this.ctx.sampleRate * 1;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(this.muted ? 0 : 0.18, this.ctx.currentTime, 0.05);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start();
    this.skid = { s, g };
  }
  skidStop() {
    if (!this.skid) return;
    const { s, g } = this.skid;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    setTimeout(() => { try { s.stop(); } catch (e) { /* ignore */ } }, 300);
    this.skid = null;
  }

  starStart() {
    if (!this.ctx || this.starLoop) return;
    const seq = [659, 784, 880, 1047, 880, 784];
    let i = 0;
    this.starLoop = setInterval(() => {
      this.tone(seq[i % seq.length], 0.13, { type: 'square', gain: 0.15 });
      i++;
    }, 140);
  }
  starStop() {
    clearInterval(this.starLoop);
    this.starLoop = null;
  }

  /* ---------- 引擎（三層：低頻脈動 / 主音 / 高頻嘶聲，含換檔） ---------- */
  engineStart() {
    if (!this.ctx || this.engine) return;
    const mk = (type) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      return o;
    };
    const o1 = mk('sawtooth'), o2 = mk('square'), o3 = mk('triangle');
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    const g3 = this.ctx.createGain();
    g3.gain.value = 0.3;
    o1.connect(f);
    o2.connect(f);
    o3.connect(g3).connect(f);
    f.connect(g).connect(this.sfxBus);
    // 風聲
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const wind = this.ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    const wf = this.ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 400;
    const wg = this.ctx.createGain();
    wg.gain.value = 0;
    wind.connect(wf).connect(wg).connect(this.sfxBus);
    o1.start(); o2.start(); o3.start(); wind.start();
    this.engine = { o1, o2, o3, f, g, wind, wg, wf };
  }
  engineUpdate(speed, throttle, boost, air) {
    if (!this.engine || !this.ctx) return;
    const t = this.ctx.currentTime;
    // 三段變速：每段內轉速隨速度上升，換段時掉回
    const gear = Math.min(2, Math.floor(speed * 3));
    const inGear = speed * 3 - gear;
    const rpm = 0.25 + inGear * 0.75;
    const base = 50 + rpm * 120 + gear * 30 + (boost ? 60 : 0) + (air ? 40 : 0);
    this.engine.o1.frequency.setTargetAtTime(base, t, 0.06);
    this.engine.o2.frequency.setTargetAtTime(base * 0.5, t, 0.06);
    this.engine.o3.frequency.setTargetAtTime(base * 2.01, t, 0.06);
    this.engine.f.frequency.setTargetAtTime(300 + rpm * 1400 + throttle * 500 + (boost ? 1500 : 0), t, 0.1);
    this.engine.g.gain.setTargetAtTime(this.muted ? 0 : 0.04 + speed * 0.07 + throttle * 0.03, t, 0.1);
    this.engine.wg.gain.setTargetAtTime(this.muted ? 0 : speed * speed * 0.12, t, 0.2);
    this.engine.wf.frequency.setTargetAtTime(300 + speed * 1200, t, 0.2);
  }
  engineStop() {
    if (!this.engine) return;
    try {
      for (const k of ['o1', 'o2', 'o3', 'wind']) this.engine[k].stop();
    } catch (e) {
      /* ignore */
    }
    this.engine = null;
    this.starStop();
    this.skidStop();
  }

  /* ---------- 程序化背景音樂 ---------- */
  music(key) {
    if (this.musicKey === key) return;
    this.musicKey = key;
    clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (!key || !this.ctx) return;
    const song = MUSIC[key];
    this.musicStep = 0;
    this.musicNext = this.ctx.currentTime + 0.1;
    const stepDur = 60 / song.bpm / 2; // 八分音符
    const tick = () => {
      if (!this.ctx || this.musicKey !== key) return;
      while (this.musicNext < this.ctx.currentTime + 0.25) {
        const i = this.musicStep;
        const b = song.bass[i % song.bass.length];
        const l = song.lead[i % song.lead.length];
        const t0 = this.musicNext - this.ctx.currentTime;
        if (b >= 0) this.tone(110 * Math.pow(2, b / 12), stepDur * 0.9, { type: 'triangle', gain: 0.35, delay: t0, bus: this.musicBus });
        if (l >= 0 && !this.muted) this.tone(440 * Math.pow(2, (l - 12) / 12), stepDur * 0.6, { type: 'square', gain: 0.12, delay: t0, bus: this.musicBus });
        // 鼓：偶數拍低鼓、奇數拍 hi-hat
        if (i % 4 === 0) this.tone(70, 0.12, { type: 'sine', gain: 0.5, slide: -50, delay: t0, bus: this.musicBus });
        if (i % 2 === 1) this.noiseTo(this.musicBus, 0.04, 0.12, 6000, t0);
        this.musicNext += stepDur;
        this.musicStep++;
      }
    };
    tick();
    this.musicTimer = setInterval(tick, 100);
  }
  noiseTo(bus, dur, gain, freq, delay) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(f).connect(g).connect(bus);
    s.start(t0);
  }

  /* ---------- 語音播報 ---------- */
  say(text, { rate = 1.08, pitch = 1.1, priority = false } = {}) {
    if (!this.voiceOn || this.muted || !window.speechSynthesis) return;
    try {
      if (priority) window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-TW';
      u.rate = rate;
      u.pitch = pitch;
      u.volume = 1;
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find((x) => x.lang === 'zh-TW' && /premium|enhanced|Mei|美/i.test(x.name)) || voices.find((x) => x.lang === 'zh-TW') || voices.find((x) => x.lang.startsWith('zh'));
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch (e) {
      /* ignore */
    }
  }
}

export const audio = new GameAudio();
