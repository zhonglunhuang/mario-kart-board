// 平衡測試：讓 AI 在每張地圖用每種車跑圈，輸出單圈時間，用來校正車種數值與 AI
//   node tools/balance.mjs [difficulty] [laps]
import { createRequire } from 'node:module';
import { Track } from '../public/js/track.js';
import { KartPhysics } from '../public/js/kart-physics.js';
import { AIDriver } from '../public/js/ai.js';

const require = createRequire(import.meta.url);
const DEFS = require('../public/shared/defs.js');
const difficulty = process.argv[2] || 'hard';
const LAPS = parseInt(process.argv[3], 10) || 2;
const DT = 1 / 60;

function runLap(mapId, kartDef, seed) {
  const track = new Track(DEFS.MAPS[mapId]);
  const phys = new KartPhysics(kartDef, track, DEFS);
  const ai = new AIDriver({ track, kartDef, difficulty, defs: DEFS, seed });
  const g = track.gridPose(0);
  phys.place(g.x, g.y, g.z, g.rot, g.hint);
  let t = 0;
  let lap = 0;
  let prevT = 0;
  let cp = 0;
  const lapTimes = [];
  let lapStart = 0;
  let walls = 0, drifts = 0, boosts = 0, jumps = 0, airTime = 0;
  const maxTime = 200 * LAPS;
  while (t < maxTime && lap < LAPS) {
    const input = ai.decide(DT, phys, { others: [], boxes: [], item: null, myProgress: lap + phys.t, humanBest: 0, humanCount: 0 });
    input.limit = ai.cfg.limit; // 無真人時不套橡皮筋
    const ev = phys.step(DT, input, { spin: false, boost: false, star: false, slow: false, racing: true }, t * 1000);
    for (const e of ev) {
      if (e.type === 'wall') walls++;
      if (e.type === 'driftStart') drifts++;
      if (e.type === 'driftBoost') boosts++;
      if (e.type === 'jump') jumps++;
    }
    if (phys.air) airTime += DT;
    const tt = phys.t;
    if (cp < 3 && prevT < track.checkpoints[cp] && tt >= track.checkpoints[cp]) cp++;
    if (prevT > 0.8 && tt < 0.2 && cp >= 3) {
      lap++;
      cp = 0;
      lapTimes.push(t - lapStart);
      lapStart = t;
    }
    prevT = tt;
    t += DT;
  }
  return { lapTimes, walls, drifts, boosts, jumps, airTime, finished: lap >= LAPS, t };
}

const results = {};
for (const mapId of Object.keys(DEFS.MAPS)) {
  results[mapId] = {};
  for (const k of DEFS.KARTS) {
    const r = runLap(mapId, k, 0.42);
    results[mapId][k.id] = r;
    const best = r.lapTimes.length ? Math.min(...r.lapTimes) : null;
    console.log(
      `${DEFS.MAPS[mapId].name.padEnd(6)} ${k.name.padEnd(6)} ${r.finished ? 'OK ' : 'DNF'} best ${best ? best.toFixed(1) + 's' : '  --  '} laps ${r.lapTimes.map((x) => x.toFixed(1)).join('/')}  walls ${r.walls} drifts ${r.drifts} boosts ${r.boosts} jumps ${r.jumps} air ${r.airTime.toFixed(1)}s`,
    );
  }
  const bests = DEFS.KARTS.map((k) => (results[mapId][k.id].lapTimes.length ? Math.min(...results[mapId][k.id].lapTimes) : Infinity));
  const spread = ((Math.max(...bests) - Math.min(...bests)) / Math.min(...bests)) * 100;
  console.log(`  → 車種單圈差距 ${spread.toFixed(1)}%\n`);
}
