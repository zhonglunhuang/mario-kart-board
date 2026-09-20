/* AI 車手：沿賽道取樣點追蹤前方目標、在彎道漂移、閃避與撿道具箱、依難度與橡皮筋調整速度 */
import { wrapAngle } from './kart-physics.js';

const DIFF = {
  easy: { limit: 0.84, noise: 0.28, react: 0.25, itemDelay: [2.5, 6], driftSkill: 0.5 },
  normal: { limit: 0.93, noise: 0.12, react: 0.12, itemDelay: [1.5, 4], driftSkill: 0.8 },
  hard: { limit: 1.0, noise: 0.05, react: 0.05, itemDelay: [0.8, 2.5], driftSkill: 1.0 },
};

export class AIDriver {
  constructor({ track, kartDef, difficulty = 'normal', defs, seed = Math.random() }) {
    this.track = track;
    this.kart = kartDef;
    this.defs = defs;
    this.cfg = DIFF[difficulty] || DIFF.normal;
    this.rng = mulberry(Math.floor(seed * 1e9));
    this.lane = (this.rng() - 0.5) * 0.9;
    this.laneTarget = this.lane;
    this.laneTimer = 0;
    this.steerNoise = 0;
    this.noiseTimer = 0;
    this.drifting = false;
    this.itemTimer = this.cfg.itemDelay[0] + this.rng() * (this.cfg.itemDelay[1] - this.cfg.itemDelay[0]);
    this.want = { steer: 0, gas: 1, brake: false, drift: false, limit: 1, useItem: null };
  }

  /**
   * @param {number} dt
   * @param {import('./kart-physics.js').KartPhysics} phys
   * @param {{others:Array<{id,x,z,y,lap,t,speed}>, boxes:Array<{x,z,available}>, item:object|null, myProgress:number, humanBest:number, humanCount:number}} ctx
   */
  decide(dt, phys, ctx) {
    const T = this.track;
    const half = T.half;
    const cfg = this.cfg;
    const speed = phys.speed;
    // 車道緩慢漂移，偶爾換道
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTimer = 3 + this.rng() * 5;
      this.laneTarget = (this.rng() - 0.5) * 1.0;
    }
    // 沒道具時朝最近的道具箱車道
    if (!ctx.item) {
      for (const b of ctx.boxes) {
        if (!b.available) continue;
        const dx = b.x - phys.x, dz = b.z - phys.z;
        const d = Math.hypot(dx, dz);
        if (d < 45 && d > 4) {
          const c = T.closest(b, phys.hint);
          let ahead = c.idx - phys.hint;
          if (ahead < -1200) ahead += 2400;
          if (ahead > 0 && ahead < 220) {
            this.laneTarget = c.lateral / (half - 2.5);
            break;
          }
        }
      }
    }
    // 閃避前方近車
    for (const o of ctx.others) {
      const dx = o.x - phys.x, dz = o.z - phys.z;
      const fwd = dx * Math.sin(phys.rot) + dz * Math.cos(phys.rot);
      if (fwd > 2 && fwd < 12) {
        const side = dx * Math.cos(phys.rot) - dz * Math.sin(phys.rot); // 正值 = 對方在左邊
        if (Math.abs(side) < 3.2) this.laneTarget += side > 0 ? 0.35 * dt * 6 : -0.35 * dt * 6;
      }
    }
    this.laneTarget = Math.max(-1, Math.min(1, this.laneTarget));
    this.lane += (this.laneTarget - this.lane) * Math.min(1, dt * 1.5);

    // 前方目標點
    const curvNear = Math.abs(T.at(phys.hint + 30).curvature) + Math.abs(T.at(phys.hint + 70).curvature);
    const look = (curvNear > 0.6 ? 20 : 28) + Math.abs(speed) * (curvNear > 0.6 ? 1.0 : 1.6);
    const s = T.at(phys.hint + look);
    const lat = this.lane * (half - 2.8);
    const tx = s.pos.x + s.right.x * lat, tz = s.pos.z + s.right.z * lat;
    const angle = wrapAngle(Math.atan2(tx - phys.x, tz - phys.z) - phys.rot);
    this.noiseTimer -= dt;
    if (this.noiseTimer <= 0) {
      this.noiseTimer = 0.4 + this.rng() * 0.8;
      this.steerNoise = (this.rng() - 0.5) * 2 * cfg.noise;
    }
    // angle 正值 = 目標在左邊；steer 正值 = 往右轉
    let steer = Math.max(-1, Math.min(1, -angle * 2.4 + this.steerNoise));
    // 漂移判斷：前方曲率
    const curvAhead = T.at(phys.hint + 90 + Math.abs(speed) * 2).curvature + T.at(phys.hint + 40).curvature;
    const wantDrift = Math.abs(curvAhead) > 0.5 && speed > 24 && !phys.air && Math.sign(-angle) === Math.sign(curvAhead) && this.rng() < cfg.driftSkill;
    if (!this.drifting && wantDrift) this.drifting = true;
    if (this.drifting && (Math.abs(curvAhead) < 0.12 || speed < 16 || phys.drift.level >= 3 && this.rng() < 0.4)) this.drifting = false;
    if (this.drifting && phys.drift.active) {
      // 漂移中依角度偏差收緊 / 放寬
      steer = Math.max(-1, Math.min(1, phys.drift.dir * 0.6 - angle * 1.6));
    } else if (this.drifting && Math.sign(steer) !== -Math.sign(curvAhead)) {
      steer = -Math.sign(curvAhead) * Math.max(0.4, Math.abs(steer));
    }
    // 急彎前收油 / 煞車
    let gas = 1;
    let brake = false;
    if (curvNear > 0.75 && speed > 24) gas = 0.15;
    if ((curvNear > 1.1 && speed > 28) || (Math.abs(angle) > 0.9 && speed > 26)) brake = true;
    if (this.drifting && Math.abs(angle) > 0.8) this.drifting = false; // 漂移失控就放掉

    // 速度上限：難度 + 橡皮筋（落後真人就加速，領先就放慢）
    let limit = cfg.limit;
    if (ctx.humanCount > 0) {
      const gap = ctx.humanBest - ctx.myProgress; // 正值 = 落後真人
      limit *= Math.max(0.82, Math.min(1.12, 1 + gap * 0.45));
    }

    // 道具
    let useItem = null;
    if (ctx.item) {
      this.itemTimer -= dt;
      if (this.itemTimer <= 0) {
        const def = this.defs.ITEMS[ctx.item.id];
        const base = def?.uses || ctx.item.id;
        const aheadClose = ctx.others.some((o) => {
          const dx = o.x - phys.x, dz = o.z - phys.z;
          const fwd = dx * Math.sin(phys.rot) + dz * Math.cos(phys.rot);
          return fwd > 3 && fwd < 45 && Math.abs(dx * Math.cos(phys.rot) - dz * Math.sin(phys.rot)) < 9;
        });
        const behindClose = ctx.others.some((o) => {
          const dx = o.x - phys.x, dz = o.z - phys.z;
          const fwd = dx * Math.sin(phys.rot) + dz * Math.cos(phys.rot);
          return fwd < -2 && fwd > -16 && Math.abs(dx * Math.cos(phys.rot) - dz * Math.sin(phys.rot)) < 6;
        });
        if (['green', 'red', 'bomb'].includes(base)) {
          if (aheadClose) useItem = { dir: 1 };
          else if (behindClose && base !== 'bomb') useItem = { dir: -1 };
          else if (this.rng() < 0.15) useItem = { dir: 1 };
        } else if (base === 'banana') {
          if (behindClose || this.rng() < 0.3) useItem = { dir: -1 };
        } else if (base === 'mushroom' || base === 'golden') {
          if (Math.abs(curvAhead) < 0.25 || phys.offroad) useItem = { dir: 1 };
        } else useItem = { dir: 1 };
        if (useItem) this.itemTimer = cfg.itemDelay[0] + this.rng() * (cfg.itemDelay[1] - cfg.itemDelay[0]);
      }
    } else {
      this.itemTimer = Math.max(this.itemTimer, 0.5);
    }
    this.want = { steer, gas, brake, drift: this.drifting, limit, useItem };
    return this.want;
  }
}

function mulberry(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
