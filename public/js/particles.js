import * as THREE from 'three';

/* 輕量粒子系統（單一 Points，物件池）＋ 輪胎痕（環形 quad 緩衝） */

function softCircle() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Particles {
  constructor(scene, max = 3000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.startSize = new Float32Array(max);
    this.alive = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softCircle() }, scaleF: { value: 300 } },
      vertexShader: `attribute float size; varying vec3 vColor; uniform float scaleF;
        void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scaleF / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vColor; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor, 1.0) * t; }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.tmpColor = new THREE.Color();
  }

  emit(x, y, z, { count = 1, color = '#ffffff', size = 0.6, life = 0.6, speed = 2, spread = 1, dir = null, gravity = 0, sizeVar = 0.4 } = {}) {
    for (let n = 0; n < count; n++) {
      if (this.alive >= this.max) return;
      const i = this.alive++;
      const c = this.tmpColor.set(color);
      this.pos[i * 3] = x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * spread * 0.5;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
      const s = speed * (0.5 + Math.random());
      if (dir) {
        this.vel[i * 3] = dir.x * s + (Math.random() - 0.5) * s * 0.6;
        this.vel[i * 3 + 1] = dir.y * s + (Math.random() - 0.5) * s * 0.6;
        this.vel[i * 3 + 2] = dir.z * s + (Math.random() - 0.5) * s * 0.6;
      } else {
        const a = Math.random() * Math.PI * 2;
        const b = (Math.random() - 0.5) * Math.PI;
        this.vel[i * 3] = Math.cos(a) * Math.cos(b) * s;
        this.vel[i * 3 + 1] = Math.sin(b) * s;
        this.vel[i * 3 + 2] = Math.sin(a) * Math.cos(b) * s;
      }
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.startSize[i] = size * (1 - sizeVar / 2 + Math.random() * sizeVar);
      this.size[i] = this.startSize[i];
      this.life[i] = this.maxLife[i] = life * (0.7 + Math.random() * 0.6);
      this.grav[i] = gravity;
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.alive) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.alive;
        if (i !== j) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[j * 3 + k];
            this.vel[i * 3 + k] = this.vel[j * 3 + k];
            this.col[i * 3 + k] = this.col[j * 3 + k];
          }
          this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.grav[i] = this.grav[j]; this.startSize[i] = this.startSize[j];
        }
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const k = this.life[i] / this.maxLife[i];
      this.size[i] = this.startSize[i] * (0.3 + 0.7 * k);
      i++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.alive);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
  }
}

/** 落雨 / 落雪：跟著鏡頭的粒子盒 */
export class Weather {
  constructor(scene, kind, count = 900) {
    this.kind = kind;
    this.count = count;
    this.box = 60;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.box;
      pos[i * 3 + 1] = Math.random() * 40;
      pos[i * 3 + 2] = (Math.random() - 0.5) * this.box;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: kind === 'snow' ? '#ffffff' : '#bcd7ff',
      size: kind === 'snow' ? 0.5 : 0.25,
      map: softCircle(),
      transparent: true,
      opacity: kind === 'snow' ? 0.9 : 0.6,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pos = pos;
  }

  update(dt, camPos) {
    const fall = this.kind === 'snow' ? 6 : 38;
    const drift = this.kind === 'snow' ? 1.5 : 0.4;
    const t = performance.now() / 1000;
    for (let i = 0; i < this.count; i++) {
      this.pos[i * 3 + 1] -= fall * dt;
      this.pos[i * 3] += Math.sin(t * 1.3 + i) * drift * dt;
      if (this.pos[i * 3 + 1] < 0) {
        this.pos[i * 3 + 1] = 40;
        this.pos[i * 3] = (Math.random() - 0.5) * this.box;
        this.pos[i * 3 + 2] = (Math.random() - 0.5) * this.box;
      }
    }
    this.points.position.set(camPos.x, camPos.y - 12, camPos.z);
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/** 輪胎痕：固定數量 quad 的環形緩衝 */
export class SkidMarks {
  constructor(scene, max = 600) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    const idx = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) {
      const a = i * 4;
      idx.set([a, a + 1, a + 2, a, a + 2, a + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color('#111111') } },
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color, vA * 0.55); }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.head = 0;
    this.last = new Map(); // key -> {x,y,z}
  }

  /** 在 (x,y,z) 位置延伸一條寬 w 的痕跡；key 區分左右輪 */
  add(key, x, y, z, rightX, rightZ, w = 0.35, strength = 1) {
    const prev = this.last.get(key);
    this.last.set(key, { x, y, z });
    if (!prev) return;
    if (Math.hypot(x - prev.x, z - prev.z) > 4) return; // 斷開
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const hw = w / 2;
    const p = this.pos;
    const b = i * 12;
    p[b] = prev.x - rightX * hw; p[b + 1] = prev.y + 0.04; p[b + 2] = prev.z - rightZ * hw;
    p[b + 3] = prev.x + rightX * hw; p[b + 4] = prev.y + 0.04; p[b + 5] = prev.z + rightZ * hw;
    p[b + 6] = x + rightX * hw; p[b + 7] = y + 0.04; p[b + 8] = z + rightZ * hw;
    p[b + 9] = x - rightX * hw; p[b + 10] = y + 0.04; p[b + 11] = z - rightZ * hw;
    for (let k = 0; k < 4; k++) this.alpha[i * 4 + k] = strength;
    this.dirty = true;
  }

  break(key) {
    this.last.delete(key);
  }

  update(dt) {
    // 慢慢淡出
    for (let i = 0; i < this.max * 4; i++) if (this.alpha[i] > 0) this.alpha[i] = Math.max(0, this.alpha[i] - dt * 0.03);
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
    if (this.dirty) {
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.dirty = false;
    }
  }
}
