import * as THREE from 'three';
import { loadAssets, buildKart, buildBanana, buildItemBox, buildShell, cloneProp, instanced, transform, propSize, propMinY } from './models.js';

const DEFS = window.DEFS;
const T = DEFS.TRACK;
const SAMPLES = 2400;
const HALF = T.width / 2;

function makeTextSprite(text, { width = 256, height = 64, color = '#ffffff', bg = 'rgba(0,0,0,0.55)', font = 'bold 36px sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, c.height, 18);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(width / 64, height / 64, 1);
  return sp;
}

function checkerTexture(n = 8) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const s = 64 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
    ctx.fillRect(x * s, y * s, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3b3b44';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.07})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  ctx.fillStyle = '#e8d34a';
  ctx.fillRect(124, 0, 8, 128);
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(3, 0, 7, 256);
  ctx.fillRect(246, 0, 7, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5fae3f';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,40,0,0.07)';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(120, 120);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class RaceScene {
  /** 使用 RaceScene.create() 建立（需先載入模型） */
  static async create(canvas, opts = {}) {
    await loadAssets(opts.onProgress);
    return new RaceScene(canvas, opts);
  }

  constructor(canvas, { mobile = false } = {}) {
    this.canvas = canvas;
    this.mobile = mobile;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8fd3ff');
    this.scene.fog = new THREE.Fog('#a9dcff', 170, 460);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 900);
    this.camera.position.set(0, 12, 30);
    this.camTarget = new THREE.Vector3();

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#4f8a33', 1.0));
    this.sun = new THREE.DirectionalLight('#fff4d6', 1.9);
    this.sun.position.set(60, 120, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.curve = new THREE.CatmullRomCurve3(T.controlPoints.map((p) => new THREE.Vector3(...p)), true, 'catmullrom', 0.5);
    this.samples = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < SAMPLES; i++) {
      const t = i / SAMPLES;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
      this.samples.push({ t, pos, tangent, right, yaw: Math.atan2(tangent.x, tangent.z) });
    }

    this.karts = new Map();
    this.shells = new Map();
    this.bananas = new Map();
    this.boxes = [];
    this.spinners = [];

    this.buildWorld();
    this.buildTrack();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.onFrame = null;
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------- 賽道幾何查詢 ---------- */
  sample(t) {
    const i = ((Math.round(t * SAMPLES) % SAMPLES) + SAMPLES) % SAMPLES;
    return this.samples[i];
  }

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
    return { idx: best, t: s.t, lateral, center: s.pos, tangent: s.tangent, right: s.right };
  }

  /** 賽道旁的世界座標（lateral 為距中心線的橫向距離，正值為右側） */
  side(t, lateral, y = 0) {
    const s = this.sample(t);
    return { pos: s.pos.clone().add(s.right.clone().multiplyScalar(lateral)).add(new THREE.Vector3(0, y, 0)), yaw: s.yaw, s };
  }

  gridPose(seat) {
    const row = Math.floor(seat / 2);
    const side = seat % 2 === 0 ? -1 : 1;
    const s = this.sample(1 - 0.006 * (row + 1));
    const pos = s.pos.clone().add(s.right.clone().multiplyScalar(side * 3.2));
    return { x: pos.x, y: pos.y, z: pos.z, rot: s.yaw };
  }

  /** 檢查某點是否離賽道夠遠 */
  farFromTrack(x, z, margin) {
    for (let i = 0; i < SAMPLES; i += 8) {
      const s = this.samples[i];
      const dx = s.pos.x - x;
      const dz = s.pos.z - z;
      if (dx * dx + dz * dz < margin * margin) return false;
    }
    return true;
  }

  /* ---------- 世界 ---------- */
  buildWorld() {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(700, 64), new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.35;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // 樹木、岩石、花草（InstancedMesh）
    const treeKinds = ['tree_default', 'tree_detailed', 'tree_oak', 'tree_pineDefaultA', 'tree_pineRoundA'];
    const buckets = {};
    const add = (name, x, z, yaw, scale) => {
      (buckets[name] ||= []).push(transform(x, -0.35 - propMinY('nature', name) * scale, z, yaw, scale));
    };
    const count = this.mobile ? 140 : 260;
    let placed = 0;
    let tries = 0;
    while (placed < count && tries < 8000) {
      tries++;
      const x = (Math.random() - 0.5) * 460;
      const z = -75 + (Math.random() - 0.5) * 420;
      if (z > 12 && Math.abs(x) < 46) continue;
      if (!this.farFromTrack(x, z, HALF + 9)) continue;
      const r = Math.random();
      if (r < 0.62) add(treeKinds[Math.floor(Math.random() * treeKinds.length)], x, z, Math.random() * Math.PI * 2, 5 + Math.random() * 4);
      else if (r < 0.75) add(Math.random() < 0.5 ? 'rock_largeA' : 'rock_largeB', x, z, Math.random() * Math.PI * 2, 3 + Math.random() * 4);
      else if (r < 0.9) add(['flower_redA', 'flower_yellowA', 'flower_purpleA'][Math.floor(Math.random() * 3)], x, z, Math.random() * Math.PI * 2, 4 + Math.random() * 2);
      else add(Math.random() < 0.5 ? 'mushroom_red' : 'mushroom_tan', x, z, Math.random() * Math.PI * 2, 3 + Math.random() * 2);
      placed++;
    }
    // 賽道邊的草叢
    for (let i = 0; i < 90; i++) {
      const t = Math.random();
      const side = Math.random() < 0.5 ? -1 : 1;
      const p = this.side(t, side * (HALF + 3 + Math.random() * 3));
      add('grass_large', p.pos.x, p.pos.z, Math.random() * Math.PI * 2, 3 + Math.random() * 2);
    }
    for (const [name, list] of Object.entries(buckets)) this.scene.add(instanced('nature', name, list));

    // 雲
    this.clouds = new THREE.Group();
    const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(4 + Math.random() * 4, 8, 8), cloudMat);
        s.position.set(j * 5 - 8, Math.random() * 2, Math.random() * 4);
        c.add(s);
      }
      c.position.set((Math.random() - 0.5) * 600, 70 + Math.random() * 30, -80 + (Math.random() - 0.5) * 500);
      c.userData.speed = 1 + Math.random() * 1.5;
      this.clouds.add(c);
    }
    this.scene.add(this.clouds);

    // 遠山
    const hillMat = new THREE.MeshStandardMaterial({ color: '#4e8f3f', roughness: 1 });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const r = 380 + Math.random() * 120;
      const h = 40 + Math.random() * 60;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(60 + Math.random() * 60, h, 7), hillMat);
      hill.position.set(Math.cos(a) * r, h / 2 - 10, -75 + Math.sin(a) * r);
      this.scene.add(hill);
    }
  }

  buildTrack() {
    // 路面
    const seg = 700;
    const verts = [];
    const uvs = [];
    const idx = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= seg; i++) {
      const t = (i % seg) / seg;
      const p = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t).normalize();
      const right = new THREE.Vector3().crossVectors(tan, up).normalize().multiplyScalar(HALF);
      const l = p.clone().sub(right);
      const r = p.clone().add(right);
      verts.push(l.x, l.y, l.z, r.x, r.y, r.z);
      uvs.push(0, i * 0.35, 1, i * 0.35);
      if (i < seg) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    const road = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.95, side: THREE.DoubleSide }));
    road.receiveShadow = true;
    this.scene.add(road);

    // 護欄（Racing Kit barrier，紅白交錯，InstancedMesh）
    const bSize = propSize('racing', 'barrierRed');
    const bScale = 1.1 / bSize.y;
    const bLen = bSize.x * bScale;
    const red = [];
    const white = [];
    let acc = 0;
    let n = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const s = this.samples[i];
      const next = this.samples[(i + 1) % SAMPLES];
      acc += s.pos.distanceTo(next.pos);
      if (acc < bLen) continue;
      acc = 0;
      for (const side of [-1, 1]) {
        const p = s.pos.clone().add(s.right.clone().multiplyScalar(side * (HALF + 0.9)));
        (n % 2 ? red : white).push(transform(p.x, p.y - propMinY('racing', 'barrierRed') * bScale, p.z, s.yaw + Math.PI / 2, bScale));
      }
      n++;
    }
    this.scene.add(instanced('racing', 'barrierRed', red), instanced('racing', 'barrierWhite', white));

    // 起點線 + 拱門
    const s0 = this.sample(0);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(T.width, 3.2), new THREE.MeshStandardMaterial({ map: checkerTexture(12) }));
    line.position.copy(s0.pos).add(new THREE.Vector3(0, 0.03, 0));
    line.lookAt(line.position.clone().add(s0.tangent));
    line.rotateX(-Math.PI / 2);
    this.scene.add(line);
    const gate = cloneProp('racing', 'overhead');
    const gSize = propSize('racing', 'overhead');
    const gScale = (T.width + 6) / gSize.x;
    gate.scale.setScalar(gScale);
    gate.position.copy(s0.pos).add(new THREE.Vector3(0, -propMinY('racing', 'overhead') * gScale, 0));
    gate.rotation.y = s0.yaw + Math.PI / 2;
    this.scene.add(gate);
    const flag = makeTextSprite('🏁 FINISH', { width: 320, height: 80, bg: 'rgba(229,37,33,0.9)', font: 'bold 44px sans-serif' });
    flag.position.copy(s0.pos).add(new THREE.Vector3(0, gSize.y * gScale + 2.5, 0));
    flag.scale.set(10, 2.5, 1);
    this.scene.add(flag);

    // 看台、帳篷、廣告牌、燈柱
    const placeProp = (name, t, lateral, yawOffset, height) => {
      const p = this.side(t, lateral);
      const sz = propSize('racing', name);
      const sc = height / sz.y;
      const g = cloneProp('racing', name);
      g.scale.setScalar(sc);
      g.position.copy(p.pos).add(new THREE.Vector3(0, -propMinY('racing', name) * sc, 0));
      g.rotation.y = p.yaw + yawOffset;
      this.scene.add(g);
      return g;
    };
    placeProp('grandStandCovered', 0.03, HALF + 14, Math.PI / 2, 12);
    placeProp('grandStand', 0.055, HALF + 13, Math.PI / 2, 9);
    placeProp('grandStand', 0.975, -(HALF + 13), -Math.PI / 2, 9);
    placeProp('tent', 0.93, -(HALF + 9), -Math.PI / 2, 5);
    placeProp('tent', 0.95, -(HALF + 9), -Math.PI / 2, 5);
    placeProp('billboard', 0.4, HALF + 8, Math.PI / 2, 7);
    placeProp('billboard', 0.62, -(HALF + 8), -Math.PI / 2, 7);
    placeProp('grandStand', 0.5, -(HALF + 12), -Math.PI / 2, 9);
    for (let i = 0; i < 16; i++) {
      const t = (i + 0.5) / 16;
      placeProp('lightPostModern', t, (i % 2 ? 1 : -1) * (HALF + 3.2), i % 2 ? Math.PI / 2 : -Math.PI / 2, 9);
    }
    // 檢查點旗幟
    for (const cp of T.checkpoints) {
      for (const side of [-1, 1]) placeProp('flagCheckers', cp, side * (HALF + 2.2), side > 0 ? Math.PI / 2 : -Math.PI / 2, 5);
    }
    // 三角錐點綴
    for (let i = 0; i < 10; i++) placeProp('pylon', Math.random(), (Math.random() < 0.5 ? -1 : 1) * (HALF + 1.8), 0, 0.9);

    // 道具箱
    this.boxPositions = [];
    for (const b of T.itemBoxes) {
      const s = this.sample(b.t);
      const pos = s.pos.clone().add(s.right.clone().multiplyScalar(b.lane * (HALF - 2.5))).add(new THREE.Vector3(0, 1.7, 0));
      const mesh = buildItemBox();
      mesh.scale.setScalar(1.4);
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this.spinners.push(mesh);
      this.boxes.push(mesh);
      this.boxPositions.push(pos);
    }
  }

  setBoxes(available) {
    if (!available) return;
    available.forEach((ok, i) => {
      const m = this.boxes[i];
      if (m) m.visible = !!ok;
    });
  }

  /* ---------- 車輛 ---------- */
  addKart(p, isLocal) {
    if (this.karts.has(p.id)) return this.karts.get(p.id);
    const ch = DEFS.CHARACTERS.find((c) => c.id === p.character) || DEFS.CHARACTERS[0];
    const kart = DEFS.KARTS.find((k) => k.id === p.kart) || DEFS.KARTS[0];
    const group = buildKart(ch, kart);
    group.rotation.order = 'YXZ';
    const label = makeTextSprite(p.name, { width: 256, height: 64, bg: 'rgba(0,0,0,0.5)' });
    label.position.set(0, 3.6, 0);
    label.scale.set(4, 1, 1);
    label.visible = !isLocal;
    group.add(label);
    const star = new THREE.PointLight('#ffd700', 0, 12);
    star.position.set(0, 1.5, 0);
    group.add(star);
    this.scene.add(group);
    const k = { id: p.id, group, color: ch.color, label, star, heavy: !!kart.heavy, x: 0, y: 0, z: 0, rot: 0, speed: 0, stamp: 0, dispX: 0, dispZ: 0, dispY: 0, dispRot: 0, spinPhase: 0, hint: -1, isLocal: !!isLocal };
    this.karts.set(p.id, k);
    return k;
  }

  removeKart(id) {
    const k = this.karts.get(id);
    if (!k) return;
    this.scene.remove(k.group);
    this.karts.delete(id);
  }

  poseKart(k, x, y, z, rot, extraYaw = 0) {
    k.dispX = x;
    k.dispY = y;
    k.dispZ = z;
    k.dispRot = rot;
    k.group.position.set(x, y, z);
    const c = this.closest(k.group.position, k.hint);
    k.hint = c.idx;
    const fwdX = Math.sin(rot);
    const fwdZ = Math.cos(rot);
    const along = fwdX * c.tangent.x + fwdZ * c.tangent.z;
    const pitch = Math.asin(Math.max(-1, Math.min(1, c.tangent.y))) * along;
    k.group.rotation.set(-pitch, rot + extraYaw, 0);
  }

  /* ---------- 道具物件 ---------- */
  syncBananas(list) {
    const want = new Set(list.map((b) => b.id));
    for (const [id, m] of this.bananas) {
      if (!want.has(id)) {
        this.scene.remove(m);
        this.bananas.delete(id);
      }
    }
    for (const b of list) {
      if (this.bananas.has(b.id)) continue;
      const m = buildBanana();
      m.scale.setScalar(1.7);
      m.position.set(b.x, b.y + 0.2, b.z);
      m.rotation.y = Math.random() * Math.PI;
      this.scene.add(m);
      this.bananas.set(b.id, m);
    }
  }

  syncShells(list) {
    const want = new Set(list.map((s) => s.id));
    for (const [id, m] of this.shells) {
      if (!want.has(id)) {
        this.scene.remove(m);
        this.shells.delete(id);
      }
    }
    for (const s of list) {
      let m = this.shells.get(s.id);
      if (!m) {
        m = buildShell(s.kind);
        this.scene.add(m);
        this.shells.set(s.id, m);
        m.position.set(s.x, s.y + 0.6, s.z);
      }
      m.userData.target = { x: s.x, y: s.y + 0.6, z: s.z };
      m.userData.owned = !!s.owned;
      if (s.owned) m.position.set(s.x, s.y + 0.6, s.z);
    }
  }

  /* ---------- 鏡頭 ---------- */
  chase(k, dt, finished) {
    if (!k) return;
    const fwd = new THREE.Vector3(Math.sin(k.dispRot), 0, Math.cos(k.dispRot));
    const pos = k.group.position;
    let desired;
    if (finished) {
      const a = performance.now() / 2500;
      desired = pos.clone().add(new THREE.Vector3(Math.sin(a) * 14, 6, Math.cos(a) * 14));
    } else {
      const speedK = Math.min(1, Math.abs(k.speed) / 45);
      desired = pos.clone().sub(fwd.clone().multiplyScalar(9.5 + speedK * 3)).add(new THREE.Vector3(0, 4.4 + speedK * 0.8, 0));
    }
    const s = 1 - Math.pow(0.0005, dt);
    this.camera.position.lerp(desired, s);
    const look = pos.clone().add(fwd.multiplyScalar(6)).add(new THREE.Vector3(0, 1.3, 0));
    this.camTarget.lerp(look, 1 - Math.pow(0.0001, dt));
    this.camera.lookAt(this.camTarget);
    this.sun.position.copy(pos).add(new THREE.Vector3(60, 120, 40));
    this.sun.target.position.copy(pos);
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = performance.now() / 1000;
    for (const s of this.spinners) {
      s.rotation.y += dt * 1.6;
      s.rotation.x += dt * 0.8;
    }
    for (const c of this.clouds.children) {
      c.position.x += dt * c.userData.speed;
      if (c.position.x > 320) c.position.x = -320;
    }
    for (const [, m] of this.shells) {
      if (!m.userData.owned && m.userData.target) {
        const tg = m.userData.target;
        m.position.lerp(new THREE.Vector3(tg.x, tg.y, tg.z), 1 - Math.pow(0.001, dt));
      }
      m.rotation.y += dt * 8;
    }
    for (const [, b] of this.bananas) b.rotation.y += dt * 0.5;
    for (const [, k] of this.karts) {
      for (const w of k.group.userData.wheels) w.rotation.x += k.speed * dt * 0.9;
      k.group.userData.mixer?.update(dt * (0.6 + Math.min(1, Math.abs(k.speed) / 30)));
      k.star.intensity = k.starOn ? 4 + Math.sin(t * 20) * 2 : 0;
    }
    if (this.onFrame) this.onFrame(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
