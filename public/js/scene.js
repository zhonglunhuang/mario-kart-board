import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { loadAssets, buildKart, buildBanana, buildItemBox, buildShell, cloneProp, instanced, transform, propSize, propMinY, setHeadlights } from './models.js';
import { Track, SAMPLES } from './track.js';
import { Particles, Weather, SkidMarks } from './particles.js';

const DEFS = window.DEFS;

/* ---------- 貼圖 ---------- */
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
function roadTexture(base) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
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
function groundTexture(base, noise) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = noise;
  for (let i = 0; i < 4000; i++) ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 2000; i++) ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(120, 120);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function mix(a, b, k) {
  return new THREE.Color(a).lerp(new THREE.Color(b), k);
}

export const QUALITY = { low: 0, medium: 1, high: 2 };

export class RaceScene {
  static async create(canvas, opts = {}) {
    await loadAssets(opts.onProgress, { simple: (QUALITY[opts.quality] ?? 2) < 2 });
    return new RaceScene(canvas, opts);
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{mobile?:boolean, map?:string, variant?:object, quality?:'low'|'medium'|'high'}} opts
   */
  constructor(canvas, { mobile = false, map = DEFS.DEFAULT_MAP, variant = {}, quality = 'high' } = {}) {
    this.canvas = canvas;
    this.mobile = mobile;
    this.quality = QUALITY[quality] ?? 2;
    this.mapId = DEFS.MAPS[map] ? map : DEFS.DEFAULT_MAP;
    this.map = DEFS.MAPS[this.mapId];
    this.variant = {
      reverse: !!variant.reverse,
      mirror: !!variant.mirror,
      time: !variant.time || variant.time === 'auto' ? this.map.theme.time || 'day' : variant.time,
      weather: !variant.weather || variant.weather === 'auto' ? this.map.theme.weather || 'clear' : variant.weather,
    };
    this.track = new Track(this.map, this.variant);
    this.half = this.track.half;
    this.theme = this.resolveTheme();
    this.night = this.variant.time === 'night';

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality >= 2 && !mobile, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality === 0 ? 1 : this.quality === 1 ? 1.25 : 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    // 手機（中 / 低畫質）不用陰影貼圖，改用貼地假陰影
    this.useShadows = this.quality >= 2;
    this.renderer.shadowMap.enabled = this.useShadows;
    this.particleScale = this.quality === 0 ? 0.35 : this.quality === 1 ? 0.6 : 1;
    this.fps = { acc: 0, n: 0, since: performance.now(), level: this.quality, lastDrop: performance.now() };
    this.onQualityDrop = null;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.night ? 1.05 : 1.05;

    const th = this.theme;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(th.sky);
    const fogK = this.quality === 0 ? 0.6 : this.quality === 1 ? 0.8 : 1;
    this.scene.fog = new THREE.Fog(th.fog, th.fogNear * fogK, th.fogFar * fogK);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 900);
    this.camera.position.set(0, 12, 30);
    this.camTarget = new THREE.Vector3();
    this.baseFov = 62;
    this.fovBoost = 0;
    this.shake = 0;
    this.camMode = 'chase'; // chase | reverse | orbit

    this.scene.add(new THREE.HemisphereLight(this.night ? '#5d6fb8' : '#ffffff', th.ground, this.night ? 0.85 : 1.0));
    this.sun = new THREE.DirectionalLight(th.sun, th.sunIntensity);
    this.sun.position.set(60, 120, 40);
    this.sun.castShadow = this.useShadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.headlight = new THREE.SpotLight('#fff3c4', this.night ? 140 : 0, 60, 0.55, 0.5, 1.1);
    this.scene.add(this.headlight, this.headlight.target);

    this.karts = new Map();
    this.shells = new Map();
    this.bananas = new Map();
    this.boxes = [];
    this.spinners = [];
    this.lampLights = [];
    this.particles = new Particles(this.scene, this.quality === 0 ? 900 : this.quality === 1 ? 1600 : 3000);
    this.skids = new SkidMarks(this.scene, this.quality === 0 ? 250 : 600);
    this.weather = this.variant.weather !== 'clear' && this.quality > 0 ? new Weather(this.scene, this.variant.weather, this.quality === 1 ? 400 : 900) : null;

    this.buildWorld();
    this.buildTrack();
    this.setupPost();

    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.onFrame = null;
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resolveTheme() {
    const th = { ...this.map.theme };
    const time = this.variant.time;
    if (time === 'night' && this.map.theme.time !== 'night') {
      th.sky = mix(th.sky, '#0b1530', 0.85).getStyle();
      th.fog = mix(th.fog, '#141f45', 0.85).getStyle();
      th.fogNear *= 0.7; th.fogFar *= 0.75;
      th.ground = mix(th.ground, '#0d1320', 0.6).getStyle();
      th.groundNoise = mix(th.groundNoise, '#000', 0.6).getStyle();
      th.hills = mix(th.hills, '#0c1428', 0.7).getStyle();
      th.sun = '#9fb4ff'; th.sunIntensity = 0.8;
    } else if (time === 'sunset' && this.map.theme.time !== 'sunset') {
      th.sky = mix(th.sky, '#ff9a5c', 0.55).getStyle();
      th.fog = mix(th.fog, '#ffb489', 0.5).getStyle();
      th.ground = mix(th.ground, '#b06a3a', 0.25).getStyle();
      th.hills = mix(th.hills, '#7a3b3b', 0.4).getStyle();
      th.sun = '#ffb37a'; th.sunIntensity = 1.6;
    } else if (time === 'day' && this.map.theme.time === 'night') {
      th.sky = '#8fd3ff'; th.fog = '#a9dcff'; th.fogNear = 170; th.fogFar = 460;
      th.ground = '#6f7f8f'; th.groundNoise = '#3f4a58'; th.hills = '#5f7f9f'; th.sun = '#fff4d6'; th.sunIntensity = 1.9;
    }
    if (this.variant.weather === 'rain') {
      th.sky = mix(th.sky, '#6b7a8a', 0.5).getStyle();
      th.fog = mix(th.fog, '#7f8c99', 0.5).getStyle();
      th.fogFar *= 0.75;
      th.sunIntensity *= 0.6;
    } else if (this.variant.weather === 'snow' && !this.map.theme.weather) {
      th.fog = mix(th.fog, '#ffffff', 0.5).getStyle();
      th.fogFar *= 0.7;
    }
    return th;
  }

  setupPost() {
    this.composer = null;
    if (this.quality < 2 || this.mobile) return;
    try {
      const size = this.renderer.getSize(new THREE.Vector2());
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(size, this.night ? 0.9 : 0.35, 0.6, this.night ? 0.55 : 0.85);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.smaa = new SMAAPass(size.x, size.y);
      this.composer.addPass(this.smaa);
    } catch (e) {
      console.warn('post-processing unavailable', e);
      this.composer = null;
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.composer?.dispose?.();
    this.onFrame = null;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.smaa?.setSize?.(w, h);
  }

  /* ---------- 相容舊介面 ---------- */
  sample(t) {
    return this.track.sample(t);
  }
  closest(pos, hint) {
    return this.track.closest(pos, hint);
  }
  gridPose(seat) {
    return this.track.gridPose(seat);
  }
  side(t, lateral, y = 0) {
    const p = this.track.side(t, lateral, y);
    return { pos: new THREE.Vector3(p.x, p.y, p.z), yaw: p.yaw, s: p.s };
  }

  /* ---------- 世界 ---------- */
  buildWorld() {
    const th = this.theme;
    const HALF = this.half;
    const T = this.track;
    const B = T.bounds;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(800, 64), new THREE.MeshStandardMaterial({ map: groundTexture(th.ground, th.groundNoise), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(B.cx, -0.35, B.cz);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // 水面 / 熔岩
    if (th.water || th.lava) {
      const mat = th.lava
        ? new THREE.MeshStandardMaterial({ color: '#ff5a1f', emissive: '#ff3d00', emissiveIntensity: 1.2, roughness: 0.6 })
        : new THREE.MeshStandardMaterial({ color: '#2aa6d9', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
      const level = th.lava ? -0.8 : -0.9;
      const plane = new THREE.Mesh(new THREE.CircleGeometry(900, 48), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(B.cx, level, B.cz);
      this.scene.add(plane);
      this.liquid = plane;
      // 把地面縮小成島（賽道周圍）
      ground.geometry.dispose();
      ground.geometry = new THREE.CircleGeometry(Math.max(B.maxX - B.minX, B.maxZ - B.minZ) * 0.85, 48);
      ground.position.y = -0.3;
    }

    const buckets = {};
    const add = (name, x, z, yaw, scale) => {
      (buckets[name] ||= []).push(transform(x, -0.35 - propMinY('nature', name) * scale, z, yaw, scale));
    };
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const spanX = B.maxX - B.minX + (th.water || th.lava ? 60 : 200);
    const spanZ = B.maxZ - B.minZ + (th.water || th.lava ? 60 : 200);
    const count = this.quality === 0 ? 70 : this.quality === 1 ? 120 : 260;
    let placed = 0;
    let tries = 0;
    const s0 = T.sample(0);
    while (placed < count && tries < 9000) {
      tries++;
      const x = B.cx + (Math.random() - 0.5) * spanX;
      const z = B.cz + (Math.random() - 0.5) * spanZ;
      if (Math.hypot(x - s0.pos.x, z - s0.pos.z) < 30 && (x - s0.pos.x) * s0.tangent.x + (z - s0.pos.z) * s0.tangent.z < 0) continue;
      if (!T.farFromTrack(x, z, HALF + 9)) continue;
      const r = Math.random();
      if (r < 0.6 && th.trees.length) add(pick(th.trees), x, z, Math.random() * Math.PI * 2, 5 + Math.random() * 4);
      else if (r < 0.78 && th.rocks.length) add(pick(th.rocks), x, z, Math.random() * Math.PI * 2, 3 + Math.random() * 5);
      else if (r < 0.9 && th.flowers.length) add(pick(th.flowers), x, z, Math.random() * Math.PI * 2, 4 + Math.random() * 2);
      else if (th.extras.length) add(pick(th.extras), x, z, Math.random() * Math.PI * 2, 3 + Math.random() * 2);
      placed++;
    }
    if (th.grass) {
      for (let i = 0; i < 90; i++) {
        const t = Math.random();
        const side = Math.random() < 0.5 ? -1 : 1;
        const p = T.side(t, side * (HALF + 3 + Math.random() * 3));
        add(th.grass, p.x, p.z, Math.random() * Math.PI * 2, 3 + Math.random() * 2);
      }
    }
    for (const [name, list] of Object.entries(buckets)) this.scene.add(instanced('nature', name, list));

    // 雲 / 星空
    this.clouds = new THREE.Group();
    if (!this.night) {
      const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
      for (let i = 0; i < 14; i++) {
        const c = new THREE.Group();
        for (let j = 0; j < 4; j++) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(4 + Math.random() * 4, 8, 8), cloudMat);
          s.position.set(j * 5 - 8, Math.random() * 2, Math.random() * 4);
          c.add(s);
        }
        c.position.set(B.cx + (Math.random() - 0.5) * 600, 90 + Math.random() * 30, B.cz + (Math.random() - 0.5) * 500);
        c.userData.speed = 1 + Math.random() * 1.5;
        this.clouds.add(c);
      }
    } else {
      const n = 600;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI * 0.45;
        pos[i * 3] = B.cx + Math.cos(a) * Math.cos(b) * 700;
        pos[i * 3 + 1] = Math.sin(b) * 700 + 20;
        pos[i * 3 + 2] = B.cz + Math.sin(a) * Math.cos(b) * 700;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: true, fog: false }));
      this.scene.add(stars);
      const moon = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 16), new THREE.MeshBasicMaterial({ color: '#fff6d0', fog: false }));
      moon.position.set(B.cx + 300, 260, B.cz - 400);
      this.scene.add(moon);
    }
    this.scene.add(this.clouds);

    // 遠山
    const hillMat = new THREE.MeshStandardMaterial({ color: th.hills, roughness: 1 });
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const r = Math.max(spanX, spanZ) * 0.9 + Math.random() * 120 + (th.water ? 150 : 0);
      const h = 50 + Math.random() * 70;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(70 + Math.random() * 70, h, 7), hillMat);
      hill.position.set(B.cx + Math.cos(a) * r, h / 2 - 12, B.cz + Math.sin(a) * r);
      this.scene.add(hill);
    }
    if (th.lava) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(160, 220, 9), new THREE.MeshStandardMaterial({ color: '#3a2323', roughness: 1 }));
      cone.position.set(B.cx, 80, B.cz - 420);
      this.scene.add(cone);
      const glow = new THREE.PointLight('#ff6a00', 400, 600);
      glow.position.set(B.cx, 200, B.cz - 420);
      this.scene.add(glow);
    }
  }

  buildTrack() {
    const th = this.theme;
    const HALF = this.half;
    const T = this.track;
    const seg = SAMPLES;
    const verts = [];
    const uvs = [];
    const idx = [];
    const baseVerts = [];
    const baseIdx = [];
    for (let i = 0; i <= seg; i++) {
      const s = T.samples[i % seg];
      const rx = s.right.x * HALF, rz = s.right.z * HALF;
      verts.push(s.pos.x - rx, s.pos.y, s.pos.z - rz, s.pos.x + rx, s.pos.y, s.pos.z + rz);
      uvs.push(0, i * 0.1, 1, i * 0.1);
      const bx = s.right.x * (HALF + 1.5), bz = s.right.z * (HALF + 1.5);
      baseVerts.push(s.pos.x - bx, s.pos.y - 0.1, s.pos.z - bz, s.pos.x - bx, -1.2, s.pos.z - bz, s.pos.x + bx, s.pos.y - 0.1, s.pos.z + bz, s.pos.x + bx, -1.2, s.pos.z + bz);
      if (i < seg) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        const b = i * 4;
        baseIdx.push(b, b + 1, b + 4, b + 1, b + 5, b + 4, b + 2, b + 6, b + 3, b + 3, b + 6, b + 7);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(th.road), roughness: this.variant.weather === 'rain' ? 0.35 : 0.95, metalness: this.variant.weather === 'rain' ? 0.2 : 0, side: THREE.DoubleSide });
    const road = new THREE.Mesh(rg, roadMat);
    road.receiveShadow = true;
    this.scene.add(road);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(baseVerts, 3));
    bg.setIndex(baseIdx);
    bg.computeVertexNormals();
    this.scene.add(new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: th.groundNoise, roughness: 1, side: THREE.DoubleSide })));

    // 護欄
    const bSize = propSize('racing', 'barrierRed');
    const bScale = 0.55 / bSize.y;
    const bLen = bSize.x * bScale;
    const red = [];
    const white = [];
    let acc = 0;
    let n = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const s = T.samples[i];
      const next = T.samples[(i + 1) % SAMPLES];
      acc += Math.hypot(next.pos.x - s.pos.x, next.pos.y - s.pos.y, next.pos.z - s.pos.z);
      if (acc < bLen) continue;
      acc = 0;
      for (const side of [-1, 1]) {
        const px = s.pos.x + s.right.x * side * (HALF + 0.9), pz = s.pos.z + s.right.z * side * (HALF + 0.9);
        (n % 2 ? red : white).push(transform(px, s.pos.y - propMinY('racing', 'barrierRed') * bScale, pz, s.yaw + Math.PI / 2, bScale));
      }
      n++;
    }
    this.scene.add(instanced('racing', 'barrierRed', red), instanced('racing', 'barrierWhite', white));

    // 起點線 + 拱門 + 地圖名
    const s0 = T.sample(0);
    const tan0 = new THREE.Vector3(s0.tangent.x, s0.tangent.y, s0.tangent.z);
    const p0 = new THREE.Vector3(s0.pos.x, s0.pos.y, s0.pos.z);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(this.map.width, 3.2), new THREE.MeshStandardMaterial({ map: checkerTexture(12) }));
    line.position.copy(p0).add(new THREE.Vector3(0, 0.03, 0));
    line.lookAt(line.position.clone().add(tan0));
    line.rotateX(-Math.PI / 2);
    this.scene.add(line);
    const gate = cloneProp('racing', 'overhead');
    const gSize = propSize('racing', 'overhead');
    const gScale = Math.min((this.map.width + 5) / gSize.x, 8.5 / gSize.y);
    gate.scale.setScalar(gScale);
    gate.position.copy(p0).add(new THREE.Vector3(0, -propMinY('racing', 'overhead') * gScale, 0));
    gate.rotation.y = s0.yaw;
    this.scene.add(gate);
    const suffix = (this.variant.reverse ? ' 逆向' : '') + (this.variant.mirror ? ' 鏡像' : '');
    const flag = makeTextSprite(`🏁 ${this.map.name}${suffix}`, { width: 420, height: 80, bg: 'rgba(229,37,33,0.9)', font: 'bold 40px sans-serif' });
    flag.position.copy(p0).add(new THREE.Vector3(0, gSize.y * gScale + 2.5, 0));
    flag.scale.set(13, 2.5, 1);
    this.scene.add(flag);

    const placeProp = (name, t, lateral, yawOffset, height) => {
      const p = T.side(t, lateral);
      const sz = propSize('racing', name);
      const sc = height / sz.y;
      const g = cloneProp('racing', name);
      g.scale.setScalar(sc);
      g.position.set(p.x, p.y - propMinY('racing', name) * sc, p.z);
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
    if (th.city) {
      // 城市：沿賽道擺車庫 / 辦公室當建築
      for (let i = 0; i < 26; i++) {
        const t = (i + 0.3) / 26;
        const side = i % 2 ? 1 : -1;
        const kind = ['pitsGarage', 'pitsOffice', 'pitsGarageClosed', 'tentClosed'][i % 4];
        placeProp(kind, t, side * (HALF + 9 + Math.random() * 6), side > 0 ? Math.PI / 2 : -Math.PI / 2, 8 + Math.random() * 10);
      }
    }
    // 燈柱（夜晚會發光）
    const lampEmissive = new THREE.MeshStandardMaterial({ color: '#fff4c4', emissive: '#ffe28a', emissiveIntensity: this.night ? 3 : 0 });
    for (let i = 0; i < 16; i++) {
      const t = (i + 0.5) / 16;
      const side = i % 2 ? 1 : -1;
      const post = placeProp('lightPostModern', t, side * (HALF + 3.2), side > 0 ? Math.PI / 2 : -Math.PI / 2, 9);
      if (this.night) {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), lampEmissive);
        const p = T.side(t, side * (HALF + 2.2), 8.4);
        bulb.position.set(p.x, p.y, p.z);
        this.scene.add(bulb);
        if (this.quality >= 2 || (this.quality === 1 && i % 4 === 0)) {
          const light = new THREE.PointLight('#ffe9b0', 60, 48, 1.5);
          light.position.set(p.x, p.y - 1, p.z);
          this.scene.add(light);
          this.lampLights.push(light);
        }
      }
      void post;
    }
    for (const cp of T.checkpoints) for (const side of [-1, 1]) placeProp('flagCheckers', cp, side * (HALF + 2.2), side > 0 ? Math.PI / 2 : -Math.PI / 2, 5);
    for (let i = 0; i < 10; i++) placeProp('pylon', Math.random(), (Math.random() < 0.5 ? -1 : 1) * (HALF + 1.8), 0, 0.9);

    // 跳台
    for (const j of T.jumps) {
      const s = T.sample(j.t - 0.004);
      const sz = propSize('racing', 'ramp');
      const sc = (this.map.width - 1) / sz.x;
      const ramp = cloneProp('racing', 'ramp');
      ramp.scale.set(sc, Math.min(sc, 2.2 / sz.y), Math.min(sc, 6 / sz.z));
      ramp.position.set(s.pos.x, s.pos.y - propMinY('racing', 'ramp') * ramp.scale.y, s.pos.z);
      ramp.rotation.y = s.yaw + (this.variant.reverse ? Math.PI : 0) + Math.PI;
      this.scene.add(ramp);
      const arrow = makeTextSprite('⬆ JUMP', { width: 256, height: 64, bg: 'rgba(255,152,0,0.85)' });
      arrow.position.set(s.pos.x, s.pos.y + 5, s.pos.z);
      arrow.scale.set(6, 1.5, 1);
      this.scene.add(arrow);
    }

    // 道具箱
    this.boxPositions = [];
    for (const bp of T.boxPositions) {
      const mesh = buildItemBox();
      mesh.scale.setScalar(1.4);
      mesh.position.set(bp.x, bp.y, bp.z);
      this.scene.add(mesh);
      this.spinners.push(mesh);
      this.boxes.push(mesh);
      this.boxPositions.push(new THREE.Vector3(bp.x, bp.y, bp.z));
    }
  }

  setBoxes(available) {
    if (!available) return;
    available.forEach((ok, i) => {
      const m = this.boxes[i];
      if (!m) return;
      if (m.visible && !ok) this.burstBox(m.position);
      m.visible = !!ok;
    });
  }

  burstBox(p) {
    this.particles.emit(p.x, p.y, p.z, { count: Math.ceil(26 * this.particleScale), color: '#ffd54f', size: 0.9, life: 0.7, speed: 9, spread: 0.6, gravity: 18 });
    this.particles.emit(p.x, p.y, p.z, { count: 14, color: '#ffffff', size: 0.6, life: 0.5, speed: 6, spread: 0.6 });
  }

  /* ---------- 車輛 ---------- */
  addKart(p, isLocal) {
    if (this.karts.has(p.id)) return this.karts.get(p.id);
    const ch = DEFS.CHARACTERS.find((c) => c.id === p.character) || DEFS.CHARACTERS[0];
    const kart = DEFS.KARTS.find((k) => k.id === p.kart) || DEFS.KARTS[0];
    const group = buildKart(ch, kart);
    group.rotation.order = 'YXZ';
    const body = new THREE.Group();
    // 兩層：outer 負責位置/yaw/pitch，body 負責 lean 與跳躍 squash
    while (group.children.length) body.add(group.children[0]);
    group.add(body);
    body.userData = group.userData;
    const label = makeTextSprite(p.name + (p.bot ? ' 🤖' : ''), { width: 256, height: 64, bg: 'rgba(0,0,0,0.5)' });
    label.position.set(0, 3.4, 0);
    label.scale.set(2.6, 0.65, 1);
    label.visible = !isLocal;
    group.add(label);
    // 貼地假陰影（沒有陰影貼圖時）
    if (!this.useShadows) {
      const blob = new THREE.Mesh(new THREE.CircleGeometry(1.9, 14), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.32, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.03;
      blob.scale.set(1, 1.4, 1);
      group.add(blob);
    }
    // 無敵星星改用車身自發光（不用每台車一盞點光源）
    const starMats = [];
    body.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive && !o.name.startsWith('wheel')) starMats.push(o.material);
    });
    // 拖在車後的道具
    const trail = new THREE.Group();
    trail.position.set(0, 0.6, -2.4);
    trail.visible = false;
    group.add(trail);
    setHeadlights(body, this.night);
    this.scene.add(group);
    const k = { id: p.id, group, body, color: ch.color, label, starMats, trail, trailKind: null, heavy: !!kart.heavy, weight: kart.weight || 1, x: 0, y: 0, z: 0, rot: 0, speed: 0, air: false, drift: 0, stamp: 0, dispX: 0, dispZ: 0, dispY: 0, dispRot: 0, spinPhase: 0, hint: -1, isLocal: !!isLocal, lean: 0, squash: 0, bot: !!p.bot };
    this.karts.set(p.id, k);
    return k;
  }

  removeKart(id) {
    const k = this.karts.get(id);
    if (!k) return;
    this.scene.remove(k.group);
    this.karts.delete(id);
  }

  poseKart(k, x, y, z, rot, extraYaw = 0, lean = 0, pitchExtra = 0) {
    k.dispX = x; k.dispY = y; k.dispZ = z; k.dispRot = rot;
    k.group.position.set(x, y, z);
    const c = this.track.closest(k.group.position, k.hint);
    k.hint = c.idx;
    const fwdX = Math.sin(rot), fwdZ = Math.cos(rot);
    const along = fwdX * c.tangent.x + fwdZ * c.tangent.z;
    const pitch = Math.asin(Math.max(-1, Math.min(1, c.tangent.y))) * along;
    k.group.rotation.set(-pitch + pitchExtra, rot + extraYaw, 0);
    k.body.rotation.z = lean;
    k.body.scale.set(1 + k.squash * 0.15, 1 - k.squash * 0.25, 1 + k.squash * 0.15);
  }

  setTrail(k, kind) {
    if (k.trailKind === kind) return;
    k.trailKind = kind;
    while (k.trail.children.length) k.trail.remove(k.trail.children[0]);
    if (!kind) {
      k.trail.visible = false;
      return;
    }
    const m = kind === 'banana' ? buildBanana() : buildShell(kind);
    m.scale.setScalar(kind === 'banana' ? 1.4 : 0.9);
    k.trail.add(m);
    k.trail.visible = true;
  }

  /* ---------- 道具物件 ---------- */
  syncBananas(list) {
    const want = new Set(list.map((b) => b.id));
    for (const [id, m] of this.bananas) {
      if (!want.has(id)) {
        this.particles.emit(m.position.x, m.position.y, m.position.z, { count: 10, color: '#ffd54f', size: 0.5, life: 0.4, speed: 4 });
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

  explode(x, y, z, big) {
    this.particles.emit(x, y + 0.5, z, { count: big ? 80 : 40, color: '#ff7043', size: big ? 2.2 : 1.4, life: 0.6, speed: big ? 16 : 10, spread: 1 });
    this.particles.emit(x, y + 0.5, z, { count: big ? 50 : 25, color: '#ffd54f', size: 1.2, life: 0.5, speed: 12, spread: 1 });
    this.particles.emit(x, y + 0.5, z, { count: 30, color: '#333333', size: 2.5, life: 1.2, speed: 4, spread: 1.5 });
    this.shakeCam(big ? 1.2 : 0.7);
    const l = new THREE.PointLight('#ff9800', 200, 40);
    l.position.set(x, y + 2, z);
    this.scene.add(l);
    setTimeout(() => this.scene.remove(l), 160);
  }

  lightningFlash() {
    const el = document.getElementById('flash');
    if (el) {
      el.style.opacity = '1';
      setTimeout(() => (el.style.opacity = '0'), 120);
    }
    this.shakeCam(0.8);
  }

  shakeCam(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  /* ---------- 鏡頭 ---------- */
  chase(k, dt, { finished = false, reverse = false, orbit = false, boost = false, speedNorm = 0 } = {}) {
    if (!k) return;
    const fwd = new THREE.Vector3(Math.sin(k.dispRot), 0, Math.cos(k.dispRot));
    const pos = k.group.position;
    let desired;
    let look;
    if (finished || orbit) {
      const a = performance.now() / (orbit ? 3200 : 2500);
      desired = pos.clone().add(new THREE.Vector3(Math.sin(a) * 13, 5.5, Math.cos(a) * 13));
      look = pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    } else if (reverse) {
      desired = pos.clone().add(fwd.clone().multiplyScalar(9)).add(new THREE.Vector3(0, 4.2, 0));
      look = pos.clone().sub(fwd.clone().multiplyScalar(6)).add(new THREE.Vector3(0, 1.3, 0));
    } else {
      desired = pos.clone().sub(fwd.clone().multiplyScalar(9.5 + speedNorm * 3)).add(new THREE.Vector3(0, 4.4 + speedNorm * 0.8, 0));
      look = pos.clone().add(fwd.clone().multiplyScalar(6)).add(new THREE.Vector3(0, 1.3, 0));
    }
    const s = 1 - Math.pow(orbit ? 0.02 : 0.0005, dt);
    this.camera.position.lerp(desired, s);
    this.camTarget.lerp(look, 1 - Math.pow(0.0001, dt));
    // 震動
    if (this.shake > 0.001) {
      const a = this.shake;
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a * 0.6, (Math.random() - 0.5) * a));
      this.shake *= Math.pow(0.02, dt);
    }
    this.camera.lookAt(this.camTarget);
    // 速度感 FOV
    const wantFov = this.baseFov + speedNorm * 9 + (boost ? 9 : 0);
    this.camera.fov += (wantFov - this.camera.fov) * (1 - Math.pow(0.01, dt));
    this.camera.updateProjectionMatrix();
    this.sun.position.copy(pos).add(new THREE.Vector3(60, 120, 40));
    this.sun.target.position.copy(pos);
    if (this.night) {
      this.headlight.position.copy(pos).add(new THREE.Vector3(0, 1.2, 0)).add(fwd.clone().multiplyScalar(1.5));
      this.headlight.target.position.copy(pos).add(fwd.clone().multiplyScalar(30)).add(new THREE.Vector3(0, -2, 0));
    }
  }

  /** 依 FPS 自動降畫質：解析度 → 陰影 → 天氣 / 粒子 */
  adapt(dt) {
    const f = this.fps;
    f.acc += dt;
    f.n++;
    const nowP = performance.now();
    if (nowP - f.since < 4000) return;
    const avg = f.n / f.acc;
    f.acc = 0; f.n = 0; f.since = nowP;
    if (avg >= 34 || nowP - f.lastDrop < 6000) return;
    f.lastDrop = nowP;
    let msg = null;
    if (this.pixelRatio > 1) {
      this.pixelRatio = 1;
      this.renderer.setPixelRatio(1);
      this.resize();
      msg = '解析度';
    } else if (this.useShadows) {
      this.useShadows = false;
      this.renderer.shadowMap.enabled = false;
      this.sun.castShadow = false;
      this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
      msg = '陰影';
    } else if (this.particleScale > 0.35 || this.weather) {
      this.particleScale = 0.35;
      if (this.weather) { this.weather.points.visible = false; this.weather = null; }
      if (this.composer) this.composer = null;
      msg = '粒子與天氣';
    }
    if (msg) {
      console.log(`[mkb] fps ${avg.toFixed(0)} → 降低 ${msg}`);
      this.onQualityDrop?.(msg, avg);
    }
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = performance.now() / 1000;
    this.adapt(dt);
    for (const s of this.spinners) {
      s.rotation.y += dt * 1.6;
      s.rotation.x += dt * 0.8;
    }
    for (const c of this.clouds.children) {
      c.position.x += dt * c.userData.speed;
      if (c.position.x > this.track.bounds.cx + 320) c.position.x = this.track.bounds.cx - 320;
    }
    if (this.liquid && this.theme.lava) this.liquid.material.emissiveIntensity = 1.0 + Math.sin(t * 2) * 0.3;
    for (const [, m] of this.shells) {
      if (!m.userData.owned && m.userData.target) {
        const tg = m.userData.target;
        m.position.lerp(new THREE.Vector3(tg.x, tg.y, tg.z), 1 - Math.pow(0.001, dt));
      }
      m.rotation.y += dt * 8;
    }
    for (const [, b] of this.bananas) b.rotation.y += dt * 0.5;
    for (const [, k] of this.karts) {
      for (const w of k.body.userData.wheels) w.rotation.x += k.speed * dt * 0.9;
      // 遠處的車不更新骨骼動畫（省 CPU）
      if (k.isLocal || k.group.position.distanceToSquared(this.camera.position) < 60 * 60) k.body.userData.mixer?.update(dt * (0.6 + Math.min(1, Math.abs(k.speed) / 30)));
      if (k.starOn) {
        const c = new THREE.Color().setHSL((t * 2) % 1, 1, 0.5);
        for (const m of k.starMats) { m.emissive.copy(c); m.emissiveIntensity = 0.7; }
        k.starWas = true;
      } else if (k.starWas) {
        for (const m of k.starMats) { m.emissive.setRGB(0, 0, 0); m.emissiveIntensity = 1; }
        k.starWas = false;
      }
      k.squash += (0 - k.squash) * Math.min(1, dt * 8);
      if (k.trail.visible) k.trail.rotation.y += dt * 4;
    }
    this.particles.scale = this.particleScale;
    this.particles.update(dt);
    this.skids.update(dt);
    this.weather?.update(dt, this.camera.position);
    if (this.onFrame) this.onFrame(dt);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
