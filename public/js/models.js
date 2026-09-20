import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

/* 3D 模型載入與組裝（Kenney CC0 素材：Car Kit / Mini Characters / Nature Kit / Racing Kit） */

const DEFS = window.DEFS;
const BASE = 'models/';

const VEHICLES = {
  standard: { file: 'kart-oobi', length: 3.4, seat: null, tintBody: true },
  sport: { file: 'race', length: 3.6, seat: [0, 0.3, -0.22] },
  offroad: { file: 'suv', length: 3.6, seat: [0, 0.55, 0.05] },
  bike: { file: 'race-future', length: 3.6, seat: [0, 0.32, -0.2] },
  monster: { file: 'tractor', length: 3.8, seat: [0, 0.78, -0.15] },
};
const NATURE = ['tree_default', 'tree_detailed', 'tree_oak', 'tree_pineDefaultA', 'tree_pineRoundA', 'tree_palm', 'tree_palmDetailedShort', 'tree_pineTallA', 'tree_pineSmallA', 'tree_cone', 'rock_largeA', 'rock_largeB', 'rock_smallA', 'rock_tallA', 'rock_tallB', 'flower_redA', 'flower_yellowA', 'flower_purpleA', 'mushroom_red', 'mushroom_tan', 'grass_large'];
const RACING = ['overhead', 'barrierRed', 'barrierWhite', 'flagCheckers', 'grandStand', 'grandStandCovered', 'tent', 'lightPostModern', 'billboard', 'pylon'];

export const assets = { vehicles: {}, characters: {}, nature: {}, racing: {}, ready: false };
const texCache = new Map();
let loadPromise = null;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** 取得貼圖的像素資料 */
function imageDataOf(texture) {
  const img = texture.image;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** 依模型 UV 取樣貼圖，找出最常見的飽和色相 */
function dominantHue(root, data) {
  const hist = new Float32Array(36);
  const { width: w, height: h, data: px } = data;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.uv) return;
    const uv = o.geometry.attributes.uv;
    const step = Math.max(1, Math.floor(uv.count / 3000));
    for (let i = 0; i < uv.count; i += step) {
      const u = uv.getX(i) % 1, v = uv.getY(i) % 1;
      const x = Math.floor(u * (w - 1)), y = Math.floor(v * (h - 1));
      const k = (y * w + x) * 4;
      const [hue, s, l] = rgbToHsl(px[k], px[k + 1], px[k + 2]);
      if (s > 0.35 && l > 0.12 && l < 0.88) hist[Math.floor(hue / 10) % 36] += 1;
    }
  });
  let best = -1, bestV = 0;
  for (let i = 0; i < 36; i++) if (hist[i] > bestV) { bestV = hist[i]; best = i; }
  return best < 0 ? null : best * 10 + 5;
}

/** 產生色相位移後的貼圖（保留灰階） */
function shiftedTexture(data, delta, key) {
  if (texCache.has(key)) return texCache.get(key);
  const { width: w, height: h } = data;
  const out = new Uint8ClampedArray(data.data);
  for (let k = 0; k < out.length; k += 4) {
    const [hue, s, l] = rgbToHsl(out[k], out[k + 1], out[k + 2]);
    if (s < 0.22) continue;
    const [r, g, b] = hslToRgb(hue + delta, s, l);
    out[k] = r; out[k + 1] = g; out[k + 2] = b;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  texCache.set(key, tex);
  return tex;
}

function bbox(obj) {
  obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj);
}

/* ---------- 載入 ---------- */
export function loadAssets(onProgress) {
  if (loadPromise) return loadPromise;
  const loader = new GLTFLoader();
  const total = Object.keys(VEHICLES).length + DEFS.CHARACTERS.length + NATURE.length + RACING.length;
  let done = 0;
  const tick = () => onProgress?.(++done / total);
  const load = (url) => new Promise((resolve, reject) => loader.load(url, (g) => { tick(); resolve(g); }, undefined, reject));

  loadPromise = (async () => {
    const jobs = [];
    for (const [id, v] of Object.entries(VEHICLES)) {
      jobs.push(load(`${BASE}vehicles/${v.file}.glb`).then((g) => {
        const root = g.scene;
        root.traverse((o) => {
          if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.material.metalness = 0; o.material.roughness = 0.75; }
        });
        // 找貼圖並讀取像素
        let tex = null;
        root.traverse((o) => { if (!tex && o.isMesh && o.material?.map) tex = o.material.map; });
        const data = tex ? imageDataOf(tex) : null;
        const box = bbox(root);
        const size = box.getSize(new THREE.Vector3());
        let seat = v.seat ? new THREE.Vector3(...v.seat) : null;
        const charNode = root.getObjectByName('character');
        if (charNode) {
          if (!seat) seat = charNode.position.clone();
          charNode.visible = false;
        }
        if (!seat) seat = new THREE.Vector3(0, size.y * 0.55, 0);
        assets.vehicles[id] = { root, data, hue: data ? dominantHue(root, data) : null, size, seat, scale: v.length / size.z, tintBody: !!v.tintBody, minY: box.min.y };
      }));
    }
    for (const ch of DEFS.CHARACTERS) {
      jobs.push(load(`${BASE}characters/character-${ch.model}.glb`).then((g) => {
        const root = g.scene;
        root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.material.metalness = 0; o.material.roughness = 0.8; } });
        const size = bbox(root).getSize(new THREE.Vector3());
        assets.characters[ch.id] = { root, clips: g.animations, height: size.y };
      }));
    }
    for (const n of NATURE) jobs.push(load(`${BASE}nature/${n}.glb`).then((g) => { assets.nature[n] = prep(g.scene); }));
    for (const r of RACING) jobs.push(load(`${BASE}racing/${r}.glb`).then((g) => { assets.racing[r] = prep(g.scene); }));
    await Promise.all(jobs);
    assets.ready = true;
    return assets;
  })();
  return loadPromise;
}

function prep(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) {
        // glTF 沒指定 metallicFactor 時預設為 1，會讓純色模型變得很暗
        o.material.metalness = 0;
        o.material.roughness = 0.9;
        o.material.side = THREE.FrontSide;
      }
    }
  });
  root.updateMatrixWorld(true);
  const box = bbox(root);
  return { root, size: box.getSize(new THREE.Vector3()), minY: box.min.y };
}

/* ---------- 車輛 + 角色 ---------- */
export function buildKart(ch, kartDef) {
  const v = assets.vehicles[kartDef.id] || assets.vehicles.standard;
  const group = new THREE.Group();
  const vehicle = v.root.clone(true);
  // 依角色顏色做色相位移（灰階不變），標準卡丁車另外把白色車身染成角色色
  const [targetHue] = rgbToHsl(...new THREE.Color(ch.color).toArray().map((x) => x * 255));
  const delta = v.hue === null ? 0 : targetHue - v.hue;
  const tex = v.data ? shiftedTexture(v.data, delta, `${kartDef.id}:${Math.round(delta)}`) : null;
  vehicle.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material.clone();
    if (tex) m.map = tex;
    if (v.tintBody && o.name === v.root.children[0]?.name) {
      m.color = new THREE.Color(ch.color).lerp(new THREE.Color('#ffffff'), 0.35);
    }
    o.material = m;
    o.castShadow = true;
  });
  vehicle.scale.setScalar(v.scale);
  vehicle.position.y = -v.minY * v.scale;
  group.add(vehicle);
  group.userData.wheels = [];
  vehicle.traverse((o) => {
    if (o.name && o.name.startsWith('wheel')) group.userData.wheels.push(o);
  });

  // 角色
  const c = assets.characters[ch.id];
  if (c) {
    const person = skeletonClone(c.root);
    const s = 1.55 / c.height;
    person.scale.setScalar(s);
    person.position.set(v.seat.x * v.scale, v.seat.y * v.scale + vehicle.position.y - 0.02, v.seat.z * v.scale);
    const mixer = new THREE.AnimationMixer(person);
    const clip = c.clips.find((a) => a.name === 'drive') || c.clips.find((a) => a.name === 'sit') || c.clips[0];
    if (clip) {
      const action = mixer.clipAction(clip);
      action.play();
      mixer.update(Math.random() * 2);
    }
    group.add(person);
    group.userData.mixer = mixer;
  }
  return group;
}

/* ---------- 道具 / 場景物件 ---------- */
export function cloneProp(kind, name) {
  const a = assets[kind][name];
  if (!a) return new THREE.Group();
  const g = a.root.clone(true);
  return g;
}

/** 把 glb 場景以 InstancedMesh 的方式大量擺放；transforms 為 Matrix4 陣列 */
export function instanced(kind, name, transforms) {
  const a = assets[kind][name];
  const group = new THREE.Group();
  if (!a || !transforms.length) return group;
  a.root.updateMatrixWorld(true);
  const m = new THREE.Matrix4();
  a.root.traverse((o) => {
    if (!o.isMesh) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, transforms.length);
    transforms.forEach((tr, i) => {
      m.multiplyMatrices(tr, o.matrixWorld);
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  });
  return group;
}

export function transform(x, y, z, yaw, scale) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale));
}

export function propSize(kind, name) {
  return assets[kind][name]?.size || new THREE.Vector3(1, 1, 1);
}
export function propMinY(kind, name) {
  return assets[kind][name]?.minY || 0;
}

const geoCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6, metalness: 0.05, ...extra });
}

/** 香蕉皮 */
export function buildBanana() {
  const g = new THREE.Group();
  const m = mat('#ffd54f');
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.5, 0, 0), new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(0.5, 0, 0));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.13, 8, false), m);
  tube.castShadow = true;
  g.add(tube);
  const tip = new THREE.Mesh(geo('bsph', () => new THREE.SphereGeometry(0.11, 6, 6)), mat('#6d4c41'));
  tip.position.set(-0.5, 0, 0);
  g.add(tip);
  return g;
}

/** 道具箱：半透明彩色方塊 + 問號 */
export function buildItemBox() {
  const g = new THREE.Group();
  const cube = new THREE.Mesh(
    geo('ibox', () => new THREE.BoxGeometry(1.3, 1.3, 1.3)),
    new THREE.MeshPhysicalMaterial({ color: '#ffb300', transparent: true, opacity: 0.6, roughness: 0.15, metalness: 0.2, emissive: '#ff8f00', emissiveIntensity: 0.35, clearcoat: 1 }),
  );
  const edges = new THREE.LineSegments(geo('iboxEdges', () => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.3, 1.3, 1.3))), new THREE.LineBasicMaterial({ color: '#fff3c4' }));
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 96px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const q = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  q.scale.set(1, 1, 1);
  g.add(cube, edges, q);
  return g;
}

/** 龜殼 */
export function buildShell(kind) {
  const g = new THREE.Group();
  const color = kind === 'red' ? '#e52521' : '#2ecc40';
  const shell = new THREE.Mesh(geo('shell', () => new THREE.SphereGeometry(0.85, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2)), mat(color, { roughness: 0.35 }));
  const rim = new THREE.Mesh(geo('shellrim', () => new THREE.CylinderGeometry(0.9, 0.8, 0.28, 14)), mat('#fff3c4'));
  rim.position.y = -0.1;
  const rimTop = new THREE.Mesh(geo('shelltop', () => new THREE.TorusGeometry(0.55, 0.08, 6, 14)), mat('#ffffff'));
  rimTop.rotation.x = Math.PI / 2;
  rimTop.position.y = 0.55;
  shell.castShadow = true;
  g.add(shell, rim, rimTop);
  return g;
}
