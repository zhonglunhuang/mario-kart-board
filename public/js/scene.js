import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildKart, buildBanana, buildItemBox, buildStar, buildTree } from './characters.js';

const DEFS = window.DEFS;
const N = DEFS.TRACK_LENGTH;
const TILES = DEFS.TILES;

// 賽道控制點（封閉曲線）
const CONTROL_POINTS = [
  [0, 0, 0], [22, 0, -1], [40, 0.5, -10], [47, 2.5, -30], [36, 4.5, -52], [12, 5, -60],
  [-14, 4, -56], [-32, 2, -42], [-50, 0.5, -26], [-46, 0, -6], [-28, 0, 5], [-12, 0, 3],
];

const TILE_COLORS = {
  start: '#f5f5f5',
  normal: '#5d5d66',
  item: '#ffca28',
  boost: '#ff7043',
  hazard: '#3e2723',
  star: '#ffd700',
};

const TILE_W = 7.0; // 橫向寬度
const TILE_D = 3.6; // 沿賽道長度

function makeTextSprite(text, { width = 128, size = 64, color = '#ffffff', bg = 'rgba(0,0,0,0.55)', font = 'bold 44px sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = size;
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
  sp.scale.set(2.0, 1.0, 1);
  return sp;
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
    ctx.fillRect(x * 8, y * 8, 8, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

function chevronTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ff7043';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#fff59d';
  for (let i = 0; i < 3; i++) {
    const y = 20 + i * 36;
    ctx.beginPath();
    ctx.moveTo(24, y + 24);
    ctx.lineTo(64, y);
    ctx.lineTo(104, y + 24);
    ctx.lineTo(104, y + 12);
    ctx.lineTo(64, y - 12);
    ctx.lineTo(24, y + 12);
    ctx.closePath();
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class KartScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8fd3ff');
    this.scene.fog = new THREE.Fog('#8fd3ff', 90, 220);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
    this.camera.position.set(0, 26, 34);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 140;
    this.controls.enablePan = false;
    this.controls.target.set(0, 0, -10);
    // 使用者拖曳時暫停跟隨，放開後恢復
    this.userInteracting = false;
    this.controls.addEventListener('start', () => (this.userInteracting = true));
    this.controls.addEventListener('end', () => (this.userInteracting = false));

    const hemi = new THREE.HemisphereLight('#ffffff', '#5b8c3a', 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff4d6', 1.6);
    sun.position.set(40, 70, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    this.curve = new THREE.CatmullRomCurve3(CONTROL_POINTS.map((p) => new THREE.Vector3(...p)), true, 'catmullrom', 0.5);
    this.frames = [];
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      this.frames.push({ pos, tangent, right });
    }

    this.spinners = [];
    this.karts = new Map();
    this.bananaMeshes = new Map();
    this.tweens = [];
    this.followId = null;
    this.followEnabled = true;
    this.lastTarget = this.controls.target.clone();

    this.buildWorld();
    this.buildTrack();

    this.marker = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 8, 32), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    this.marker.rotation.x = Math.PI / 2;
    this.marker.visible = false;
    this.scene.add(this.marker);
    this.markerId = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    this.running = true;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------- 建立世界 ---------- */
  buildWorld() {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(260, 48), new THREE.MeshStandardMaterial({ color: '#6fbf4a', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.3;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // 賽道底下的柏油緞帶
    const seg = 320;
    const verts = [];
    const uvs = [];
    const idx = [];
    for (let i = 0; i <= seg; i++) {
      const t = (i % seg) / seg;
      const p = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t).normalize();
      const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(TILE_W / 2 + 0.8);
      const l = p.clone().sub(right);
      const r = p.clone().add(right);
      verts.push(l.x, l.y - 0.25, l.z, r.x, r.y - 0.25, r.z);
      uvs.push(0, i, 1, i);
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
    const road = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: '#3a3a42', roughness: 0.95, side: THREE.DoubleSide }));
    road.receiveShadow = true;
    this.scene.add(road);

    // 樹木
    const treeGroup = new THREE.Group();
    const samples = this.curve.getSpacedPoints(200);
    let placed = 0;
    let tries = 0;
    while (placed < 70 && tries < 2000) {
      tries++;
      const x = (Math.random() - 0.5) * 170;
      const z = -28 + (Math.random() - 0.5) * 150;
      if (z > 8 && Math.abs(x) < 30) continue; // 起點前方留空，避免擋住預設鏡頭
      let ok = true;
      for (const s of samples) {
        if ((s.x - x) ** 2 + (s.z - z) ** 2 < 11 * 11) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const tree = buildTree(0.8 + Math.random() * 0.9);
      tree.position.set(x, -0.3, z);
      treeGroup.add(tree);
      placed++;
    }
    this.scene.add(treeGroup);

    // 雲
    this.clouds = new THREE.Group();
    const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    for (let i = 0; i < 12; i++) {
      const c = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(2 + Math.random() * 2, 8, 8), cloudMat);
        s.position.set(j * 2.5 - 4, Math.random() * 1.2, Math.random() * 2);
        c.add(s);
      }
      c.position.set((Math.random() - 0.5) * 220, 32 + Math.random() * 14, -30 + (Math.random() - 0.5) * 200);
      c.userData.speed = 0.4 + Math.random() * 0.6;
      this.clouds.add(c);
    }
    this.scene.add(this.clouds);
  }

  buildTrack() {
    const tileGeo = new THREE.BoxGeometry(TILE_W, 0.5, TILE_D);
    const chev = chevronTexture();
    const checker = checkerTexture();
    for (let i = 0; i < N; i++) {
      const f = this.frames[i];
      const type = TILES[i];
      const m = new THREE.MeshStandardMaterial({ color: TILE_COLORS[type], roughness: 0.8 });
      if (type === 'normal' && i % 2 === 0) m.color.set('#6b6b75');
      const tile = new THREE.Mesh(tileGeo, m);
      tile.position.copy(f.pos);
      tile.lookAt(f.pos.clone().add(f.tangent));
      tile.receiveShadow = true;
      tile.castShadow = false;
      this.scene.add(tile);

      // 邊緣白線
      const edge = new THREE.Mesh(new THREE.BoxGeometry(TILE_W + 0.3, 0.1, 0.25), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
      edge.position.copy(f.pos).add(new THREE.Vector3(0, 0.22, 0)).add(f.tangent.clone().multiplyScalar(TILE_D / 2));
      edge.lookAt(edge.position.clone().add(f.tangent));
      this.scene.add(edge);

      // 格號
      const label = makeTextSprite(String(i), { bg: 'rgba(0,0,0,0.5)' });
      label.position.copy(f.pos).add(f.right.clone().multiplyScalar(TILE_W / 2 + 1.6)).add(new THREE.Vector3(0, 1.2, 0));
      label.scale.set(1.6, 0.8, 1);
      this.scene.add(label);

      // 特殊格裝飾
      const up = new THREE.Vector3(0, 0.26, 0);
      if (type === 'start') {
        const top = new THREE.Mesh(new THREE.PlaneGeometry(TILE_W, TILE_D), new THREE.MeshStandardMaterial({ map: checker }));
        top.position.copy(f.pos).add(up);
        top.lookAt(top.position.clone().add(f.tangent));
        top.rotateX(-Math.PI / 2);
        this.scene.add(top);
        // 拱門
        const postMat = new THREE.MeshStandardMaterial({ color: '#e52521' });
        for (const side of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 7, 10), postMat);
          post.position.copy(f.pos).add(f.right.clone().multiplyScalar(side * (TILE_W / 2 + 0.6))).add(new THREE.Vector3(0, 3.5, 0));
          post.castShadow = true;
          this.scene.add(post);
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(TILE_W + 1.7, 0.9, 0.6), new THREE.MeshStandardMaterial({ map: checker }));
        beam.position.copy(f.pos).add(new THREE.Vector3(0, 7, 0));
        beam.lookAt(beam.position.clone().add(f.tangent));
        this.scene.add(beam);
        const flag = makeTextSprite('🏁 START', { width: 256, bg: 'rgba(229,37,33,0.9)', font: 'bold 40px sans-serif' });
        flag.position.copy(f.pos).add(new THREE.Vector3(0, 8.4, 0));
        flag.scale.set(4, 2, 1);
        this.scene.add(flag);
      } else if (type === 'item') {
        const ib = buildItemBox();
        ib.position.copy(f.pos).add(new THREE.Vector3(0, 1.6, 0));
        this.spinners.push(ib);
        this.scene.add(ib);
      } else if (type === 'boost') {
        const top = new THREE.Mesh(new THREE.PlaneGeometry(TILE_W - 0.6, TILE_D - 0.4), new THREE.MeshStandardMaterial({ map: chev, emissive: '#ff5722', emissiveIntensity: 0.25 }));
        top.position.copy(f.pos).add(up);
        top.lookAt(top.position.clone().add(f.tangent));
        top.rotateX(-Math.PI / 2);
        this.scene.add(top);
      } else if (type === 'hazard') {
        const oil = new THREE.Mesh(new THREE.CircleGeometry(1.5, 16), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.2, metalness: 0.6 }));
        oil.position.copy(f.pos).add(up);
        oil.rotation.x = -Math.PI / 2;
        oil.scale.set(1.6, 1, 1);
        this.scene.add(oil);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 12), new THREE.MeshStandardMaterial({ color: '#8d6e63' }));
        barrel.position.copy(f.pos).add(f.right.clone().multiplyScalar(TILE_W / 2 + 1.0)).add(new THREE.Vector3(0, 0.6, 0));
        barrel.castShadow = true;
        this.scene.add(barrel);
      } else if (type === 'star') {
        const st = buildStar();
        st.position.copy(f.pos).add(new THREE.Vector3(0, 1.8, 0));
        this.spinners.push(st);
        this.scene.add(st);
      }
    }
  }

  /* ---------- 位置 ---------- */
  slotPosition(absPos, seat) {
    const i = ((absPos % N) + N) % N;
    const f = this.frames[i];
    const lane = ((seat % 4) - 1.5) * 1.55;
    const along = seat >= 4 ? 0.9 : -0.3;
    return f.pos.clone().add(f.right.clone().multiplyScalar(lane)).add(f.tangent.clone().multiplyScalar(along)).add(new THREE.Vector3(0, 0.25, 0));
  }

  orientKart(group, absPos) {
    const i = ((absPos % N) + N) % N;
    const f = this.frames[i];
    const target = group.position.clone().add(f.tangent);
    group.lookAt(target);
  }

  setPlayers(players) {
    for (const [, k] of this.karts) this.scene.remove(k.group);
    this.karts.clear();
    for (const p of players) {
      const ch = DEFS.CHARACTERS.find((c) => c.id === p.character) || DEFS.CHARACTERS[0];
      const kart = DEFS.KARTS.find((k) => k.id === p.kart) || DEFS.KARTS[0];
      const group = buildKart(ch, kart);
      group.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      this.scene.add(group);
      this.karts.set(p.id, { group, pos: p.pos, seat: p.seat, color: ch.color });
      this.placeKart(p.id, p.pos);
    }
  }

  placeKart(id, absPos) {
    const k = this.karts.get(id);
    if (!k) return;
    k.pos = absPos;
    k.group.position.copy(this.slotPosition(absPos, k.seat));
    this.orientKart(k.group, absPos);
  }

  removeKart(id) {
    const k = this.karts.get(id);
    if (!k) return;
    this.scene.remove(k.group);
    this.karts.delete(id);
  }

  tween(dur, fn) {
    return new Promise((resolve) => {
      this.tweens.push({ start: performance.now(), dur, fn, resolve });
    });
  }

  /** 逐格移動動畫；kind 決定特效 */
  async animateMove(id, from, to, kind) {
    const k = this.karts.get(id);
    if (!k) return;
    const dir = to > from ? 1 : -1;
    const backwards = dir < 0;
    const hit = ['bump', 'banana', 'green', 'red', 'blue', 'lightning'].includes(kind);
    let cur = from;
    while (cur !== to) {
      const next = cur + dir;
      const a = this.slotPosition(cur, k.seat);
      const b = this.slotPosition(next, k.seat);
      const dur = kind === 'boost' || kind === 'mushroom' ? 140 : backwards ? 240 : 200;
      const startRot = k.group.rotation.y;
      await this.tween(dur, (t) => {
        const e = backwards ? t : t * t * (3 - 2 * t);
        k.group.position.lerpVectors(a, b, e);
        k.group.position.y += Math.sin(t * Math.PI) * (hit ? 1.2 : backwards ? 0.15 : 0.45);
        for (const w of k.group.userData.wheels) w.rotation.x += 0.35 * dir;
        if (hit) k.group.rotation.y = startRot + t * Math.PI * 2;
      });
      cur = next;
      k.pos = cur;
      this.orientKart(k.group, cur);
    }
    k.group.position.copy(this.slotPosition(to, k.seat));
    this.orientKart(k.group, to);
  }

  setBananas(map) {
    const want = new Set(Object.keys(map || {}).map((s) => Number(s)));
    for (const [tile, mesh] of this.bananaMeshes) {
      if (!want.has(tile)) {
        this.scene.remove(mesh);
        this.bananaMeshes.delete(tile);
      }
    }
    for (const tile of want) {
      if (this.bananaMeshes.has(tile)) continue;
      const b = buildBanana();
      const f = this.frames[tile];
      b.position.copy(f.pos).add(new THREE.Vector3(0, 0.3, 0)).add(f.right.clone().multiplyScalar(2.6));
      b.rotation.y = Math.random() * Math.PI;
      this.scene.add(b);
      this.bananaMeshes.set(tile, b);
    }
  }

  setCurrent(id) {
    this.markerId = id;
    const k = id ? this.karts.get(id) : null;
    this.marker.visible = !!k;
    if (k) this.marker.material.color.set(k.color);
  }

  focus(id) {
    this.followId = id;
  }

  setFollow(enabled) {
    this.followEnabled = enabled;
  }

  overview() {
    this.followEnabled = false;
    this.camera.position.set(0, 95, 45);
    this.controls.target.set(0, 0, -28);
    this.lastTarget.copy(this.controls.target);
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const now = performance.now();
    const t = now / 1000;

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      const p = Math.min(1, (now - tw.start) / tw.dur);
      tw.fn(p);
      if (p >= 1) {
        this.tweens.splice(i, 1);
        tw.resolve();
      }
    }

    for (const s of this.spinners) {
      s.rotation.y += dt * 1.5;
      s.rotation.x += dt * 0.7;
      s.position.y += Math.sin(t * 2 + s.position.x) * 0.004;
    }
    for (const c of this.clouds.children) {
      c.position.x += dt * c.userData.speed;
      if (c.position.x > 130) c.position.x = -130;
    }

    if (this.markerId) {
      const k = this.karts.get(this.markerId);
      if (k) {
        this.marker.position.copy(k.group.position).setY(k.group.position.y + 0.05);
        this.marker.rotation.z += dt * 2;
      }
    }

    if (this.followEnabled && this.followId && !this.userInteracting) {
      const k = this.karts.get(this.followId);
      if (k) {
        const want = k.group.position.clone().add(new THREE.Vector3(0, 0.8, 0));
        const next = this.controls.target.clone().lerp(want, 1 - Math.pow(0.001, dt));
        const delta = next.clone().sub(this.controls.target);
        this.controls.target.copy(next);
        this.camera.position.add(delta);
        const dist = this.camera.position.distanceTo(this.controls.target);
        if (dist > 40) {
          const dirv = this.camera.position.clone().sub(this.controls.target).normalize();
          this.camera.position.copy(this.controls.target).add(dirv.multiplyScalar(THREE.MathUtils.lerp(dist, 26, 1 - Math.pow(0.05, dt))));
        }
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
