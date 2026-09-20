/* 街機風卡丁車物理（純 JS，無 DOM 依賴）：加速 / 轉向 / 漂移蓄力 / 跳台與騰空 / 撞牆反彈 / 車與車碰撞
 * 本地玩家、房主模擬的 AI 車、Node 平衡測試共用 */

export function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const GRAVITY = 30;

export class KartPhysics {
  /**
   * @param {object} kartDef DEFS.KARTS 內的車種
   * @param {import('./track.js').Track} track
   * @param {object} defs DEFS（DRIFT 常數）
   */
  constructor(kartDef, track, defs) {
    this.kart = kartDef;
    this.track = track;
    this.DRIFT = defs.DRIFT;
    this.x = 0; this.y = 0; this.z = 0; this.rot = 0;
    this.speed = 0; this.vy = 0; this.air = false; this.hop = false;
    this.steer = 0; this.hint = -1; this.t = 0; this.lateral = 0; this.offroad = false; this.curvature = 0;
    this.drift = { active: false, dir: 0, charge: 0, level: 0 };
    this.miniTurboUntil = 0; this.miniTurboMul = 1;
    this.spinYaw = 0; this.lean = 0; this.pitch = 0; this.wall = false; this.wallCooldown = 0;
    this.slope = 0;
    this.jumpCooldown = 0;
    this.events = [];
  }

  place(x, y, z, rot, hint) {
    this.x = x; this.y = y; this.z = z; this.rot = rot;
    this.hint = hint ?? -1;
    this.speed = 0; this.vy = 0; this.air = false; this.hop = false;
    this.drift = { active: false, dir: 0, charge: 0, level: 0 };
  }

  get boosting() {
    return this._boosting;
  }

  /**
   * @param {number} dt 秒
   * @param {{steer:number, gas:number, brake:boolean, drift:boolean, limit?:number}} input
   * @param {{spin:boolean, boost:boolean, star:boolean, slow:boolean, racing:boolean, weatherGrip?:number}} fx
   * @param {number} now 毫秒（伺服器時間）
   * @returns {Array<object>} 事件
   */
  step(dt, input, fx, now) {
    const ev = [];
    const K = this.kart;
    const T = this.track;
    const c0 = T.closest(this, this.hint);
    this.hint = c0.idx;
    const half = T.half;
    const grip = fx.weatherGrip ?? 1;
    const offroad = Math.abs(c0.lateral) > half - 1.3;
    this.offroad = offroad;
    const miniTurbo = now < this.miniTurboUntil;
    const boost = fx.boost || miniTurbo;
    this._boosting = boost;
    const controllable = fx.racing && !fx.spin && (!this.air || this.hop);

    if (fx.spin) {
      this.speed = damp(this.speed, 0, 4, dt);
      this.spinYaw += dt * ((Math.PI * 4) / 1.4);
      if (this.drift.active) this.endDrift(now, ev, false);
    } else {
      this.spinYaw = 0;
      let maxSpeed = K.maxSpeed * (input.limit ?? 1);
      if (fx.boost) maxSpeed *= 1.55;
      else if (miniTurbo) maxSpeed *= this.miniTurboMul;
      if (fx.star) maxSpeed *= 1.25;
      if (fx.slow) maxSpeed *= 0.6;
      if (offroad && !boost && !fx.star) maxSpeed *= K.offroad;
      const accel = K.accel * (boost ? 2.5 : 1);
      if (controllable && input.gas > 0) this.speed += accel * input.gas * dt;
      else if (!this.air) this.speed = damp(this.speed, 0, fx.racing ? 0.7 : 2.5, dt);
      if (controllable && input.brake) this.speed -= accel * 1.7 * dt;
      if (this.speed > maxSpeed) this.speed = damp(this.speed, maxSpeed, boost ? 2 : 5, dt);
      const minSpeed = -K.maxSpeed * 0.35;
      if (this.speed < minSpeed) this.speed = minSpeed;

      // ---- 漂移 ----
      const D = this.DRIFT;
      const steerIn = controllable ? input.steer : 0;
      if (!this.drift.active && controllable && input.drift && !this.air && this.speed > D.minSpeed && Math.abs(steerIn) > 0.15) {
        this.drift = { active: true, dir: Math.sign(steerIn), charge: 0, level: 0 };
        this.vy = 3.2;
        this.air = true;
        this.hop = true;
        ev.push({ type: 'driftStart', dir: this.drift.dir });
      }
      if (this.drift.active) {
        const stop = !input.drift || this.speed < D.minSpeed * 0.7 || (this.air && !this.hop) || !fx.racing;
        if (stop) this.endDrift(now, ev, true);
        else {
          const inward = Math.max(0, steerIn * this.drift.dir); // 往漂移方向推桿：收緊
          const outward = Math.max(0, -steerIn * this.drift.dir); // 反推：放寬
          // steer 正值 = 右轉 = yaw 減少（與一般轉向同號）
          const yawRate = K.turn * K.drift * this.drift.dir * (0.38 + 0.42 * inward - 0.22 * outward) * grip;
          this.rot -= yawRate * dt;
          this.drift.charge += dt * (0.7 + 0.6 * inward + 0.15 * outward) * (K.driftCharge || 1);
          let lvl = 0;
          for (const L of D.levels) if (this.drift.charge >= L) lvl++;
          if (lvl !== this.drift.level) {
            this.drift.level = lvl;
            ev.push({ type: 'driftLevel', level: lvl });
          }
          // 漂移中略掉速
          if (!boost && this.speed > maxSpeed * 0.94) this.speed = damp(this.speed, maxSpeed * 0.94, 3, dt);
          this.steer = damp(this.steer, steerIn, 10, dt);
        }
      }
      if (!this.drift.active) {
        this.steer = damp(this.steer, steerIn, 14, dt);
        // 高速時一般轉向會轉向不足（最多剩 65%），要維持緊的路線就得漂移
        const under = 1 - 0.35 * Math.min(1, Math.abs(this.speed) / K.maxSpeed);
        const g = Math.min(1, Math.abs(this.speed) / 9) * grip * under;
        this.rot -= K.turn * this.steer * g * dt * (this.speed < 0 ? -1 : 1);
      }
    }

    // ---- 位移 ----
    this.x += Math.sin(this.rot) * this.speed * dt;
    this.z += Math.cos(this.rot) * this.speed * dt;
    const c = T.closest(this, this.hint);
    this.hint = c.idx;
    this.t = c.t;
    this.lateral = c.lateral;
    this.curvature = c.curvature;
    const groundY = c.center.y;

    // ---- 垂直：跳台 / 山頂騰空 / 落地 ----
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (!this.air) {
      const jump = this.jumpCooldown <= 0 ? T.jumpNear(c.idx) : null;
      const along = Math.sin(this.rot) * c.tangent.x + Math.cos(this.rot) * c.tangent.z;
      if (jump && this.speed * along > 10) {
        this.jumpCooldown = 1.5;
        this.vy = (7 + Math.abs(this.speed) * 0.24) * (jump.power || 1);
        this.air = true;
        this.hop = false;
        if (this.drift.active) this.endDrift(now, ev, true);
        ev.push({ type: 'jump', power: jump.power || 1 });
      } else if (groundY < this.y - 0.45 && Math.abs(this.speed) > 22) {
        this.air = true;
        this.hop = false;
        this.vy = 0;
        if (this.drift.active) this.endDrift(now, ev, true);
      } else {
        this.y = groundY;
      }
    }
    if (this.air) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= groundY) {
        const impact = -this.vy;
        this.y = groundY;
        this.air = false;
        this.vy = 0;
        if (!this.hop) {
          if (impact > 14) this.speed *= 0.85;
          ev.push({ type: 'land', impact });
        }
        this.hop = false;
      }
    }

    // ---- 護欄反彈 ----
    const limit = half - 0.3;
    if (Math.abs(c.lateral) > limit) {
      const sign = Math.sign(c.lateral);
      this.x = c.center.x + c.right.x * sign * limit;
      this.z = c.center.z + c.right.z * sign * limit;
      const vx = Math.sin(this.rot) * this.speed, vz = Math.cos(this.rot) * this.speed;
      const nx = -sign * c.right.x, nz = -sign * c.right.z; // 指向賽道內側
      const vn = vx * nx + vz * nz;
      if (vn < 0 && !this.wall) {
        const e = 0.35;
        const rx = vx - (1 + e) * vn * nx, rz = vz - (1 + e) * vn * nz;
        const mag = Math.hypot(rx, rz);
        const fwdDot = rx * Math.sin(this.rot) + rz * Math.cos(this.rot);
        this.speed = mag * 0.72 * (fwdDot < 0 ? -1 : 1);
        if (mag > 0.5 && this.speed > 0) this.rot = lerpAngle(this.rot, Math.atan2(rx, rz), 0.7);
        this.wall = true;
        this.wallCooldown = 0.25;
        if (this.drift.active) this.endDrift(now, ev, false);
        ev.push({ type: 'wall', strength: -vn, side: sign });
      }
    }
    if (this.wall) {
      this.wallCooldown -= dt;
      if (this.wallCooldown <= 0 && Math.abs(c.lateral) < limit - 0.2) this.wall = false;
    }

    // ---- 視覺姿態 ----
    const targetLean = -this.steer * 0.16 - (this.drift.active ? this.drift.dir * 0.14 : 0);
    this.lean = damp(this.lean, targetLean, 8, dt);
    const along = Math.sin(this.rot) * c.tangent.x + Math.cos(this.rot) * c.tangent.z;
    this.slope = Math.asin(Math.max(-1, Math.min(1, c.tangent.y))) * along;
    this.pitch = damp(this.pitch, this.air ? Math.max(-0.35, Math.min(0.35, this.vy * 0.03)) : 0, 6, dt);
    this.events = ev;
    return ev;
  }

  endDrift(now, ev, rewarded) {
    const d = this.drift;
    if (rewarded && d.level > 0) {
      const i = d.level - 1;
      this.miniTurboUntil = now + this.DRIFT.boostMs[i];
      this.miniTurboMul = this.DRIFT.boostMul[i];
      ev.push({ type: 'driftBoost', level: d.level });
    } else if (d.active) {
      ev.push({ type: 'driftEnd' });
    }
    this.drift = { active: false, dir: 0, charge: 0, level: 0 };
  }

  /** 與另一台車（以回報位置與速度顯示）的碰撞；只更新自己 */
  collideWith(o, oWeight, star) {
    const dx = this.x - o.x;
    const dz = this.z - o.z;
    const d = Math.hypot(dx, dz);
    const R = 3.0;
    if (d >= R || d < 0.001) return null;
    if (Math.abs((o.y ?? this.y) - this.y) > 2.5) return null;
    const nx = dx / d, nz = dz / d;
    const mA = this.kart.weight || 1, mB = oWeight || 1;
    const push = (R - d) * (mB / (mA + mB)) * 1.05;
    this.x += nx * push;
    this.z += nz * push;
    const vax = Math.sin(this.rot) * this.speed, vaz = Math.cos(this.rot) * this.speed;
    const vbx = Math.sin(o.rot) * (o.speed || 0), vbz = Math.cos(o.rot) * (o.speed || 0);
    const rel = (vax - vbx) * nx + (vaz - vbz) * nz;
    if (rel >= 0) return { strength: 0 };
    const e = 0.45;
    const j = (-(1 + e) * rel) / (1 / mA + 1 / mB);
    const nvx = vax + (j / mA) * nx, nvz = vaz + (j / mA) * nz;
    const mag = Math.hypot(nvx, nvz);
    const fwdDot = nvx * Math.sin(this.rot) + nvz * Math.cos(this.rot);
    if (!star) {
      this.speed = mag * (fwdDot < 0 ? -0.5 : 1);
      this.rot = lerpAngle(this.rot, Math.atan2(nvx, nvz), 0.25);
    }
    return { strength: -rel, heavyHit: mB > mA * 1.4 && -rel > 8 };
  }

  snapshot() {
    return { x: this.x, y: this.y, z: this.z, rot: this.rot, speed: this.speed, t: this.t, air: this.air && !this.hop, drift: this.drift.active ? this.drift.level : 0 };
  }
}
