import * as THREE from 'three';

/* 程序化生成的低多邊形角色 + 車輛（不使用任何版權素材） */

const geoCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.65, metalness: 0.05, ...extra });
}

function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geo(`box${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d)), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function sphere(r, m, x = 0, y = 0, z = 0, seg = 16) {
  const mesh = new THREE.Mesh(geo(`sph${r}_${seg}`, () => new THREE.SphereGeometry(r, seg, seg)), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 16) {
  const mesh = new THREE.Mesh(geo(`cyl${rt}_${rb}_${h}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function cone(r, h, m, x = 0, y = 0, z = 0, seg = 12) {
  const mesh = new THREE.Mesh(geo(`cone${r}_${h}_${seg}`, () => new THREE.ConeGeometry(r, h, seg)), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

const WHEEL_MAT = mat('#1f1f1f', { roughness: 0.9 });
const RIM_MAT = mat('#d9d9d9', { metalness: 0.5, roughness: 0.3 });
const DARK = mat('#222222');
const WHITE = mat('#ffffff');

function wheel(r, w, x, y, z) {
  const g = new THREE.Group();
  const tire = cyl(r, r, w, WHEEL_MAT, 0, 0, 0, 18);
  tire.rotation.z = Math.PI / 2;
  const rim = cyl(r * 0.55, r * 0.55, w + 0.02, RIM_MAT, 0, 0, 0, 12);
  rim.rotation.z = Math.PI / 2;
  g.add(tire, rim);
  g.position.set(x, y, z);
  g.userData.wheel = true;
  return g;
}

/** 車體，回傳 { group, seatY } */
function buildBody(kartId, color) {
  const g = new THREE.Group();
  const body = mat(color);
  const trim = mat('#f5f5f5');
  let seatY = 0.8;
  switch (kartId) {
    case 'sport': {
      g.add(box(1.7, 0.4, 2.9, body, 0, 0.5, 0));
      g.add(box(1.2, 0.25, 1.0, trim, 0, 0.8, 0.6)); // 引擎蓋
      g.add(box(1.9, 0.08, 0.5, DARK, 0, 1.05, -1.3)); // 尾翼
      g.add(box(0.1, 0.35, 0.4, DARK, -0.8, 0.85, -1.3));
      g.add(box(0.1, 0.35, 0.4, DARK, 0.8, 0.85, -1.3));
      g.add(wheel(0.32, 0.3, -0.95, 0.32, 1.0), wheel(0.32, 0.3, 0.95, 0.32, 1.0));
      g.add(wheel(0.36, 0.34, -0.95, 0.36, -1.0), wheel(0.36, 0.34, 0.95, 0.36, -1.0));
      seatY = 0.7;
      break;
    }
    case 'offroad': {
      g.add(box(1.8, 0.6, 2.4, body, 0, 0.9, 0));
      g.add(box(1.9, 0.12, 0.4, DARK, 0, 0.7, 1.3)); // 前保桿
      g.add(box(0.9, 0.35, 0.9, trim, 0, 1.35, 0.55));
      g.add(wheel(0.5, 0.42, -1.05, 0.5, 0.85), wheel(0.5, 0.42, 1.05, 0.5, 0.85));
      g.add(wheel(0.5, 0.42, -1.05, 0.5, -0.85), wheel(0.5, 0.42, 1.05, 0.5, -0.85));
      seatY = 1.2;
      break;
    }
    case 'bike': {
      g.add(box(0.55, 0.5, 2.0, body, 0, 0.8, 0));
      g.add(box(0.5, 0.25, 0.7, DARK, 0, 1.1, -0.4)); // 坐墊
      const bar = cyl(0.04, 0.04, 1.0, DARK, 0, 1.25, 0.8, 8);
      bar.rotation.z = Math.PI / 2;
      g.add(bar);
      const fork = cyl(0.05, 0.05, 0.9, RIM_MAT, 0, 0.8, 0.9, 8);
      fork.rotation.x = 0.35;
      g.add(fork);
      g.add(wheel(0.45, 0.24, 0, 0.45, 1.0), wheel(0.45, 0.24, 0, 0.45, -0.95));
      seatY = 1.2;
      break;
    }
    case 'monster': {
      g.add(box(1.9, 0.7, 2.5, body, 0, 1.45, 0));
      g.add(box(1.5, 0.4, 1.0, trim, 0, 2.0, 0.5));
      g.add(box(2.0, 0.1, 2.3, DARK, 0, 1.0, 0)); // 底盤
      g.add(wheel(0.72, 0.55, -1.15, 0.72, 0.95), wheel(0.72, 0.55, 1.15, 0.72, 0.95));
      g.add(wheel(0.72, 0.55, -1.15, 0.72, -0.95), wheel(0.72, 0.55, 1.15, 0.72, -0.95));
      seatY = 1.8;
      break;
    }
    default: {
      g.add(box(1.6, 0.5, 2.4, body, 0, 0.6, 0));
      g.add(box(1.0, 0.3, 0.8, trim, 0, 0.95, 0.6));
      g.add(box(1.7, 0.1, 0.3, DARK, 0, 0.5, 1.25));
      g.add(wheel(0.35, 0.3, -0.9, 0.35, 0.85), wheel(0.35, 0.3, 0.9, 0.35, 0.85));
      g.add(wheel(0.35, 0.3, -0.9, 0.35, -0.85), wheel(0.35, 0.3, 0.9, 0.35, -0.85));
      seatY = 0.85;
    }
  }
  return { group: g, seatY };
}

/** 角色（坐姿） */
function buildCharacter(ch) {
  const g = new THREE.Group();
  const skin = mat(ch.skin);
  const shirt = mat(ch.shirt);
  const s = ch.bigger ? 1.2 : 1;

  // 身體
  g.add(box(0.7, 0.6, 0.5, shirt, 0, 0.3, 0));
  // 腿
  g.add(box(0.22, 0.2, 0.5, mat('#2a3a8a'), -0.2, 0.05, 0.35));
  g.add(box(0.22, 0.2, 0.5, mat('#2a3a8a'), 0.2, 0.05, 0.35));
  // 手臂伸向方向盤
  const armL = cyl(0.07, 0.07, 0.55, shirt, -0.3, 0.45, 0.3, 8);
  armL.rotation.x = -1.1;
  const armR = cyl(0.07, 0.07, 0.55, shirt, 0.3, 0.45, 0.3, 8);
  armR.rotation.x = -1.1;
  g.add(armL, armR);
  g.add(sphere(0.09, WHITE, -0.3, 0.55, 0.55, 8), sphere(0.09, WHITE, 0.3, 0.55, 0.55, 8));
  // 方向盤
  const wheelMesh = new THREE.Mesh(geo('torus', () => new THREE.TorusGeometry(0.22, 0.04, 8, 16)), DARK);
  wheelMesh.position.set(0, 0.55, 0.62);
  wheelMesh.rotation.x = -0.4;
  g.add(wheelMesh);

  // 頭
  const headY = 0.95;
  g.add(sphere(0.38, skin, 0, headY, 0));
  // 眼睛
  const eyeW = sphere(0.09, WHITE, -0.13, headY + 0.05, 0.32, 8);
  const eyeW2 = sphere(0.09, WHITE, 0.13, headY + 0.05, 0.32, 8);
  const pupil = sphere(0.045, DARK, -0.13, headY + 0.05, 0.4, 6);
  const pupil2 = sphere(0.045, DARK, 0.13, headY + 0.05, 0.4, 6);
  g.add(eyeW, eyeW2, pupil, pupil2);
  // 鼻子 / 嘴
  if (ch.snout) {
    g.add(sphere(0.2, mat(ch.skin), 0, headY - 0.1, 0.38, 12));
    g.add(sphere(0.06, DARK, -0.07, headY - 0.06, 0.55, 6), sphere(0.06, DARK, 0.07, headY - 0.06, 0.55, 6));
  } else {
    g.add(sphere(0.09, mat(ch.skin), 0, headY - 0.05, 0.38, 8));
  }
  if (ch.mustache) g.add(box(0.36, 0.08, 0.08, mat('#3b2412'), 0, headY - 0.15, 0.36));
  if (ch.tie) g.add(box(0.18, 0.4, 0.06, mat(ch.tie), 0, 0.35, 0.28));

  // 帽子
  const hatColor = mat(ch.hatColor || ch.color);
  switch (ch.hat) {
    case 'cap': {
      const cap = new THREE.Mesh(geo('halfsphere', () => new THREE.SphereGeometry(0.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), hatColor);
      cap.position.set(0, headY + 0.05, 0);
      cap.castShadow = true;
      const brim = cyl(0.34, 0.34, 0.05, hatColor, 0, headY + 0.1, 0.22, 12);
      brim.scale.set(1, 1, 1.4);
      g.add(cap, brim);
      // 帽徽
      g.add(cyl(0.11, 0.11, 0.03, WHITE, 0, headY + 0.25, 0.36, 12).rotateX(Math.PI / 2));
      break;
    }
    case 'crown': {
      const hair = new THREE.Mesh(geo('halfsphere2', () => new THREE.SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 1.7)), mat(ch.hair || '#ffe066'));
      hair.position.set(0, headY + 0.02, -0.04);
      g.add(hair);
      g.add(box(0.5, 0.35, 0.3, mat(ch.hair || '#ffe066'), 0, headY - 0.3, -0.25));
      const crown = cyl(0.22, 0.2, 0.18, hatColor, 0, headY + 0.45, 0, 8);
      g.add(crown);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.add(cone(0.06, 0.15, hatColor, Math.cos(a) * 0.17, headY + 0.6, Math.sin(a) * 0.17, 6));
      }
      break;
    }
    case 'mushroom': {
      const cap = new THREE.Mesh(geo('halfsphere3', () => new THREE.SphereGeometry(0.55, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)), hatColor);
      cap.position.set(0, headY + 0.05, 0);
      cap.castShadow = true;
      g.add(cap);
      const spot = mat(ch.spots || '#e52521');
      [[0, 0.5, 0.2], [0.35, 0.3, 0.3], [-0.35, 0.3, 0.3], [0, 0.35, -0.42], [0.4, 0.25, -0.25], [-0.4, 0.25, -0.25]].forEach(([x, y, z]) => {
        g.add(sphere(0.12, spot, x, headY + y, z, 8));
      });
      break;
    }
    case 'spikes': {
      // 火紅頭髮
      for (let i = -1; i <= 1; i++) g.add(cone(0.1, 0.35, hatColor, i * 0.16, headY + 0.45, -0.05, 6));
      // 背後的龜殼
      const shell = new THREE.Mesh(geo('halfsphere4', () => new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)), mat('#2e7d32'));
      shell.position.set(0, 0.25, -0.35);
      shell.rotation.x = -Math.PI / 2;
      g.add(shell);
      for (let i = 0; i < 3; i++) g.add(cone(0.06, 0.2, mat('#fff3c4'), (i - 1) * 0.25, 0.4, -0.6, 6).rotateX(-Math.PI / 2));
      // 眉毛
      g.add(box(0.18, 0.05, 0.05, DARK, -0.14, headY + 0.18, 0.36).rotateZ(-0.4));
      g.add(box(0.18, 0.05, 0.05, DARK, 0.14, headY + 0.18, 0.36).rotateZ(0.4));
      break;
    }
    default: {
      if (ch.id === 'dk') {
        g.add(cone(0.08, 0.25, mat('#5a2d0c'), 0, headY + 0.45, 0, 6));
        g.add(sphere(0.2, mat('#d9b38c'), 0, headY - 0.1, 0.3, 10)); // 嘴部
      }
      if (ch.id === 'yoshi') {
        g.add(cone(0.08, 0.25, mat('#e52521'), 0, headY + 0.42, -0.1, 6));
        g.add(cone(0.07, 0.2, mat('#e52521'), 0, headY + 0.35, -0.28, 6).rotateX(-0.6));
      }
    }
  }

  g.scale.setScalar(s);
  return g;
}

/**
 * 建立完整的玩家車輛（車體 + 角色），面向 +Z
 * @param {object} ch DEFS.CHARACTERS 內的角色
 * @param {object} kart DEFS.KARTS 內的車種
 */
export function buildKart(ch, kart) {
  const root = new THREE.Group();
  const { group, seatY } = buildBody(kart.id, ch.color);
  root.add(group);
  const person = buildCharacter(ch);
  person.position.set(0, seatY - 0.1, -0.35);
  root.add(person);
  root.userData.wheels = [];
  group.traverse((o) => {
    if (o.userData.wheel) root.userData.wheels.push(o);
  });
  return root;
}

/** 香蕉皮 */
export function buildBanana() {
  const g = new THREE.Group();
  const m = mat('#ffd54f');
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.5, 0, 0), new THREE.Vector3(0, 0.55, 0), new THREE.Vector3(0.5, 0, 0));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.12, 8, false), m);
  tube.castShadow = true;
  g.add(tube);
  g.add(sphere(0.1, mat('#6d4c41'), -0.5, 0, 0, 6));
  return g;
}

/** 道具箱：半透明旋轉方塊 */
export function buildItemBox() {
  const m = new THREE.MeshStandardMaterial({ color: '#ffd54f', transparent: true, opacity: 0.75, roughness: 0.2, metalness: 0.3, emissive: '#7a5b00' });
  const mesh = new THREE.Mesh(geo('itembox', () => new THREE.BoxGeometry(1.2, 1.2, 1.2)), m);
  const q = new THREE.Mesh(geo('qsphere', () => new THREE.SphereGeometry(0.35, 10, 10)), mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.4 }));
  const g = new THREE.Group();
  g.add(mesh, q);
  return g;
}

/** 星星 */
export function buildStar(color = '#ffd700') {
  const shape = new THREE.Shape();
  const R = 0.7;
  const r = 0.3;
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geoStar = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false });
  const mesh = new THREE.Mesh(geoStar, mat(color, { emissive: color, emissiveIntensity: 0.35 }));
  mesh.castShadow = true;
  return mesh;
}

/** 樹 */
export function buildTree(scale = 1) {
  const g = new THREE.Group();
  g.add(cyl(0.25, 0.35, 1.5, mat('#6d4c41'), 0, 0.75, 0, 8));
  const leaf = mat(['#2e7d32', '#388e3c', '#43a047'][Math.floor(Math.random() * 3)]);
  g.add(cone(1.4, 2.2, leaf, 0, 2.3, 0, 8));
  g.add(cone(1.1, 1.8, leaf, 0, 3.3, 0, 8));
  g.scale.setScalar(scale);
  return g;
}
