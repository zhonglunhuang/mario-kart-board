/* 賽道幾何（純 JS，無 DOM / three 依賴；瀏覽器與 Node 的平衡測試共用）
 * 以均勻 Catmull-Rom 樣條建立封閉曲線，再以等弧長重新取樣。 */

export const SAMPLES = 2400;

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  }
  return out;
}

export class Track {
  /**
   * @param {object} map DEFS.MAPS[id]
   * @param {{reverse?:boolean, mirror?:boolean}} variant
   */
  constructor(map, variant = {}) {
    this.map = map;
    this.variant = { reverse: !!variant.reverse, mirror: !!variant.mirror };
    this.width = map.width;
    this.half = map.width / 2;
    let pts = map.controlPoints.map((p) => [this.variant.mirror ? -p[0] : p[0], p[1], p[2]]);
    if (this.variant.reverse) pts = [pts[0], ...pts.slice(1).reverse()];
    this.controlPoints = pts;

    // 細取樣後依弧長等距重取樣
    const n = pts.length;
    const fine = [];
    const SUB = 60;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (let j = 0; j < SUB; j++) fine.push(catmull(p0, p1, p2, p3, j / SUB));
    }
    const cum = [0];
    for (let i = 1; i <= fine.length; i++) {
      const a = fine[i - 1], b = fine[i % fine.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    this.length = cum[fine.length];
    this.samples = [];
    let k = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const target = (i / SAMPLES) * this.length;
      while (k < fine.length - 1 && cum[k + 1] < target) k++;
      const a = fine[k], b = fine[(k + 1) % fine.length];
      const segLen = cum[k + 1] - cum[k] || 1;
      const u = (target - cum[k]) / segLen;
      const pos = { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, z: a[2] + (b[2] - a[2]) * u };
      this.samples.push({ t: i / SAMPLES, pos });
    }
    // 切線 / 右向量 / 曲率
    for (let i = 0; i < SAMPLES; i++) {
      const prev = this.samples[(i - 1 + SAMPLES) % SAMPLES].pos;
      const next = this.samples[(i + 1) % SAMPLES].pos;
      const tx = next.x - prev.x, ty = next.y - prev.y, tz = next.z - prev.z;
      const len = Math.hypot(tx, ty, tz) || 1;
      const tangent = { x: tx / len, y: ty / len, z: tz / len };
      const rl = Math.hypot(tangent.z, tangent.x) || 1;
      const right = { x: -tangent.z / rl, y: 0, z: tangent.x / rl }; // tangent × up
      const s = this.samples[i];
      s.tangent = tangent;
      s.right = right;
      s.yaw = Math.atan2(tangent.x, tangent.z);
      s.idx = i;
    }
    for (let i = 0; i < SAMPLES; i++) {
      const a = this.samples[(i - 15 + SAMPLES) % SAMPLES].yaw;
      const b = this.samples[(i + 15) % SAMPLES].yaw;
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.samples[i].curvature = d; // 正值 = 左彎
    }
    // 跳台 / 道具箱 / 檢查點（reverse 時 t 對映為 1-t）
    const mapT = (t) => (this.variant.reverse ? (1 - t + 1) % 1 : t);
    this.jumps = (map.jumps || []).map((j) => ({ ...j, t: mapT(j.t), idx: this.indexAt(mapT(j.t)) }));
    this.itemBoxes = map.itemBoxes.map((b, i) => ({ ...b, index: i, t: mapT(b.t), lane: this.variant.mirror ? -b.lane : b.lane }));
    this.checkpoints = map.checkpoints;
    this.boxPositions = this.itemBoxes.map((b) => {
      const s = this.sample(b.t);
      return { x: s.pos.x + s.right.x * b.lane * (this.half - 2.5), y: s.pos.y + 1.7, z: s.pos.z + s.right.z * b.lane * (this.half - 2.5), index: b.index };
    });
    this.jumpMask = new Uint8Array(SAMPLES);
    for (const j of this.jumps) for (let d = -6; d <= 6; d++) this.jumpMask[(j.idx + d + SAMPLES) % SAMPLES] = 1;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of this.samples) {
      minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x); minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
    }
    this.bounds = { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  }

  indexAt(t) {
    return ((Math.round(t * SAMPLES) % SAMPLES) + SAMPLES) % SAMPLES;
  }
  sample(t) {
    return this.samples[this.indexAt(t)];
  }
  at(idx) {
    const i = Math.round(idx);
    return this.samples[((i % SAMPLES) + SAMPLES) % SAMPLES];
  }

  /** 最近的取樣點；hint 為上次 index 可加速 */
  closest(pos, hint) {
    let best = -1;
    let bestD = Infinity;
    const check = (i) => {
      const s = this.samples[((i % SAMPLES) + SAMPLES) % SAMPLES];
      const dx = s.pos.x - pos.x;
      const dz = s.pos.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = ((i % SAMPLES) + SAMPLES) % SAMPLES;
      }
    };
    if (hint === undefined || hint < 0) {
      for (let i = 0; i < SAMPLES; i += 4) check(i);
      const c = best;
      for (let i = c - 4; i <= c + 4; i++) check(i);
    } else {
      for (let i = hint - 60; i <= hint + 60; i++) check(i);
      if (bestD > 60 * 60) {
        bestD = Infinity;
        for (let i = 0; i < SAMPLES; i += 4) check(i);
      }
    }
    const s = this.samples[best];
    const lateral = (pos.x - s.pos.x) * s.right.x + (pos.z - s.pos.z) * s.right.z;
    return { idx: best, t: s.t, lateral, center: s.pos, tangent: s.tangent, right: s.right, yaw: s.yaw, curvature: s.curvature };
  }

  /** 賽道旁的世界座標 */
  side(t, lateral, y = 0) {
    const s = this.sample(t);
    return { x: s.pos.x + s.right.x * lateral, y: s.pos.y + y, z: s.pos.z + s.right.z * lateral, yaw: s.yaw, s };
  }

  gridPose(seat) {
    const row = Math.floor(seat / 2);
    const side = seat % 2 === 0 ? -1 : 1;
    const s = this.sample(1 - 0.006 * (row + 1));
    const off = side * Math.min(3.2, this.half * 0.4);
    return { x: s.pos.x + s.right.x * off, y: s.pos.y, z: s.pos.z + s.right.z * off, rot: s.yaw, hint: s.idx };
  }

  isJump(idx) {
    return this.jumpMask[((idx % SAMPLES) + SAMPLES) % SAMPLES] === 1;
  }
  jumpNear(idx) {
    for (const j of this.jumps) {
      let d = Math.abs(j.idx - idx);
      d = Math.min(d, SAMPLES - d);
      if (d <= 6) return j;
    }
    return null;
  }

  farFromTrack(x, z, margin) {
    for (let i = 0; i < SAMPLES; i += 8) {
      const s = this.samples[i];
      const dx = s.pos.x - x;
      const dz = s.pos.z - z;
      if (dx * dx + dz * dz < margin * margin) return false;
    }
    return true;
  }
}
