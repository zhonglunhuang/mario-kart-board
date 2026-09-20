/* 音效（WebAudio 合成，不需要任何音檔）＋ 語音播報（瀏覽器內建 TTS） */

class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.voiceOn = true;
    try {
      this.muted = localStorage.getItem('mkb-muted') === '1';
      this.voiceOn = localStorage.getItem('mkb-voice') !== '0';
    } catch (e) {
      /* ignore */
    }
    this.engine = null;
    this.starLoop = null;
  }

  /** 必須在使用者手勢（點擊）之後呼叫，iOS 才允許播放 */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(this.ctx.destination);
    // iOS：播一個無聲 buffer 解鎖
    const b = this.ctx.createBuffer(1, 1, 22050);
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.ctx.destination);
    s.start(0);
    if (window.speechSynthesis) window.speechSynthesis.getVoices();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
    try {
      localStorage.setItem('mkb-muted', m ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
    if (m && window.speechSynthesis) window.speechSynthesis.cancel();
  }

  setVoice(on) {
    this.voiceOn = on;
    try {
      localStorage.setItem('mkb-voice', on ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------- 基本合成 ---------- */
  tone(freq, dur, { type = 'square', gain = 0.25, attack = 0.005, decay = dur, slide = 0, delay = 0 } = {}) {
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
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise(dur, { gain = 0.3, freq = 800, q = 0.7, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(f).connect(g).connect(this.master);
    s.start(t0);
  }

  /* ---------- 遊戲音效 ---------- */
  countdownBeep(n) {
    this.tone(n === 0 ? 880 : 440, n === 0 ? 0.6 : 0.18, { type: 'square', gain: 0.3 });
    if (n === 0) this.tone(1320, 0.5, { type: 'square', gain: 0.15, delay: 0.05 });
  }
  pickup() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', gain: 0.25, delay: i * 0.06 }));
  }
  itemGet() {
    [784, 988, 1175].forEach((f, i) => this.tone(f, 0.16, { type: 'square', gain: 0.2, delay: i * 0.09 }));
  }
  useItem(item) {
    if (item === 'mushroom') this.tone(300, 0.5, { type: 'sawtooth', gain: 0.25, slide: 900 });
    else if (item === 'star') this.starStart();
    else if (item === 'lightning') this.noise(0.6, { gain: 0.5, freq: 3000, q: 0.3 });
    else this.noise(0.25, { gain: 0.4, freq: 1200 });
  }
  hit() {
    this.noise(0.5, { gain: 0.6, freq: 400, q: 0.5 });
    this.tone(200, 0.5, { type: 'sawtooth', gain: 0.3, slide: -150 });
  }
  bump() {
    this.noise(0.12, { gain: 0.35, freq: 600 });
  }
  wall() {
    this.noise(0.2, { gain: 0.4, freq: 300 });
  }
  lap() {
    [659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, { type: 'triangle', gain: 0.25, delay: i * 0.12 }));
  }
  finish(rank) {
    const notes = rank === 1 ? [523, 659, 784, 1047, 784, 1047] : [392, 494, 587, 784];
    notes.forEach((f, i) => this.tone(f, 0.25, { type: 'square', gain: 0.22, delay: i * 0.15 }));
  }
  click() {
    this.tone(700, 0.05, { type: 'square', gain: 0.12 });
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

  /* ---------- 引擎聲 ---------- */
  engineStart() {
    if (!this.ctx || this.engine) return;
    const o1 = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    o1.connect(f);
    o2.connect(f);
    f.connect(g).connect(this.master);
    o1.start();
    o2.start();
    this.engine = { o1, o2, f, g };
  }
  /** speed 0..1, throttle 0..1 */
  engineUpdate(speed, throttle, boost) {
    if (!this.engine || !this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 55 + speed * 160 + (boost ? 60 : 0);
    this.engine.o1.frequency.setTargetAtTime(base, t, 0.08);
    this.engine.o2.frequency.setTargetAtTime(base * 0.5, t, 0.08);
    this.engine.f.frequency.setTargetAtTime(300 + speed * 1500 + throttle * 400, t, 0.1);
    this.engine.g.gain.setTargetAtTime(this.muted ? 0 : 0.05 + speed * 0.08 + throttle * 0.03, t, 0.1);
  }
  engineStop() {
    if (!this.engine) return;
    try {
      this.engine.o1.stop();
      this.engine.o2.stop();
    } catch (e) {
      /* ignore */
    }
    this.engine = null;
    this.starStop();
  }

  /* ---------- 語音播報 ---------- */
  say(text, { rate = 1.05, pitch = 1.1, priority = false } = {}) {
    if (!this.voiceOn || this.muted || !window.speechSynthesis) return;
    try {
      if (priority) window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-TW';
      u.rate = rate;
      u.pitch = pitch;
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find((x) => x.lang === 'zh-TW') || voices.find((x) => x.lang.startsWith('zh'));
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch (e) {
      /* ignore */
    }
  }
}

export const audio = new GameAudio();
