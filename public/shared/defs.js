/* 伺服器與瀏覽器共用的遊戲定義 */
(function (exports) {
  const CHECKPOINTS = [0.25, 0.5, 0.75];
  const boxes = (ts) => ts.flatMap((t) => [-0.6, 0, 0.6].map((lane) => ({ t, lane })));

  /* ---------- 地圖 ----------
   * controlPoints：封閉曲線控制點；jumps：跳台位置（t）；theme：配色與擺設
   * 變體（reverse / mirror / time / weather）由房間設定決定，客戶端建場景時套用 */
  exports.MAPS = {
    meadow: {
      id: 'meadow', name: '綠野賽道', emoji: '🌳', desc: '平坦寬闊，適合新手', difficulty: 1, width: 18,
      controlPoints: [
        [0, 0, 0], [60, 0, -4], [110, 1, -30], [130, 6, -85], [100, 12, -145], [35, 12, -165],
        [-40, 9, -155], [-90, 4, -115], [-140, 1, -70], [-125, 0, -15], [-75, 0, 12], [-30, 0, 8],
      ],
      itemBoxes: boxes([0.08, 0.31, 0.55, 0.8]),
      jumps: [{ t: 0.44, power: 1 }],
      checkpoints: CHECKPOINTS,
      theme: {
        sky: '#8fd3ff', fog: '#a9dcff', fogNear: 170, fogFar: 460,
        ground: '#5fae3f', groundNoise: '#2f6b20', hills: '#4e8f3f', road: '#3b3b44', dust: '#8fbf6a',
        trees: ['tree_default', 'tree_detailed', 'tree_oak', 'tree_pineDefaultA', 'tree_pineRoundA'],
        rocks: ['rock_largeA', 'rock_largeB'], flowers: ['flower_redA', 'flower_yellowA', 'flower_purpleA'],
        extras: ['mushroom_red', 'mushroom_tan'], grass: 'grass_large', sun: '#fff4d6', sunIntensity: 1.9,
      },
    },
    canyon: {
      id: 'canyon', name: '峽谷沙漠', emoji: '🏜️', desc: '髮夾彎與 S 型連續彎，難度中等', difficulty: 2, width: 16,
      controlPoints: [
        [0, 0, 0], [70, 0, -5], [120, 3, -30], [150, 8, -80], [125, 14, -125], [78, 14, -108],
        [36, 10, -145], [62, 6, -195], [20, 4, -228], [-45, 2, -205], [-62, 6, -152], [-112, 10, -132],
        [-152, 6, -80], [-132, 2, -30], [-82, 0, -5], [-30, 0, 3],
      ],
      itemBoxes: boxes([0.07, 0.24, 0.42, 0.6, 0.78, 0.93]),
      jumps: [{ t: 0.16, power: 1.1 }, { t: 0.66, power: 0.9 }],
      checkpoints: CHECKPOINTS,
      theme: {
        sky: '#ffcf8a', fog: '#f5c98f', fogNear: 150, fogFar: 420,
        ground: '#e0b96a', groundNoise: '#a8783a', hills: '#c2703f', road: '#4a4038', dust: '#e8c98a',
        trees: ['tree_palm', 'tree_palmDetailedShort', 'tree_palm'], rocks: ['rock_tallA', 'rock_tallB', 'rock_largeA', 'rock_largeB'],
        flowers: ['flower_yellowA'], extras: ['rock_smallA'], grass: 'grass_large', sun: '#ffe2b0', sunIntensity: 2.2,
      },
    },
    alpine: {
      id: 'alpine', name: '雪山高地', emoji: '🏔️', desc: '大幅爬升與下坡，窄路高難度', difficulty: 3, width: 14,
      controlPoints: [
        [0, 0, 0], [50, 2, -10], [92, 10, -42], [102, 22, -92], [72, 32, -132], [20, 36, -152],
        [-32, 34, -132], [-22, 26, -92], [-62, 20, -72], [-112, 14, -92], [-132, 8, -42], [-92, 2, -10], [-40, 0, 2],
      ],
      itemBoxes: boxes([0.1, 0.3, 0.52, 0.72, 0.9]),
      jumps: [{ t: 0.36, power: 1.2 }],
      checkpoints: CHECKPOINTS,
      theme: {
        sky: '#cfe6ff', fog: '#e6f1ff', fogNear: 120, fogFar: 380,
        ground: '#f2f6fa', groundNoise: '#b9c9d8', hills: '#dfe9f2', road: '#4b4f58', dust: '#ffffff',
        trees: ['tree_pineTallA', 'tree_pineDefaultA', 'tree_pineSmallA', 'tree_cone'], rocks: ['rock_largeA', 'rock_tallA'],
        flowers: [], extras: ['rock_smallA'], grass: null, sun: '#ffffff', sunIntensity: 1.7, weather: 'snow',
      },
    },
    harbor: {
      id: 'harbor', name: '港灣夜城', emoji: '🌃', desc: '夜間街道、長直線接急彎', difficulty: 2, width: 17,
      controlPoints: [
        [0, 0, 0], [90, 0, 0], [160, 0, -20], [170, 2, -70], [130, 4, -110], [60, 4, -100],
        [10, 6, -130], [-30, 6, -180], [-100, 4, -170], [-140, 2, -120], [-120, 0, -60], [-150, 0, -20], [-100, 0, 12], [-40, 0, 6],
      ],
      itemBoxes: boxes([0.05, 0.28, 0.48, 0.7, 0.88]),
      jumps: [{ t: 0.22, power: 1 }, { t: 0.58, power: 1.3 }],
      checkpoints: CHECKPOINTS,
      theme: {
        sky: '#0b1530', fog: '#141f45', fogNear: 120, fogFar: 380,
        ground: '#2b2f3a', groundNoise: '#171a22', hills: '#1c2340', road: '#33353d', dust: '#8a8f9c',
        trees: ['tree_cone', 'tree_thin'], rocks: ['rock_largeB'], flowers: [], extras: ['rock_smallA'], grass: null,
        sun: '#9fb4ff', sunIntensity: 0.8, time: 'night', city: true,
      },
    },
    beach: {
      id: 'beach', name: '陽光海灘', emoji: '🏖️', desc: '寬闊海岸線，大跳台', difficulty: 1, width: 19,
      controlPoints: [
        [0, 0, 0], [80, 0, 4], [140, 1, -30], [150, 3, -90], [110, 5, -140], [40, 5, -150],
        [-30, 3, -120], [-90, 3, -140], [-140, 2, -90], [-130, 1, -30], [-70, 0, 8],
      ],
      itemBoxes: boxes([0.1, 0.35, 0.6, 0.85]),
      jumps: [{ t: 0.3, power: 1.4 }, { t: 0.75, power: 1 }],
      checkpoints: CHECKPOINTS,
      theme: {
        sky: '#7fd0ff', fog: '#bfe9ff', fogNear: 180, fogFar: 500,
        ground: '#f0dca0', groundNoise: '#c9b070', hills: '#3f9fd8', road: '#45464f', dust: '#f5e6b8',
        trees: ['tree_palm', 'tree_palmDetailedShort', 'tree_palm', 'tree_palm'], rocks: ['rock_largeA', 'rock_smallA'],
        flowers: ['flower_redA', 'flower_yellowA'], extras: ['rock_smallA'], grass: 'grass_large', sun: '#fff8e0', sunIntensity: 2.3, water: true,
      },
    },
    volcano: {
      id: 'volcano', name: '熔岩火山', emoji: '🌋', desc: '連續髮夾彎與陡坡，專家級', difficulty: 3, width: 14,
      controlPoints: [
        [0, 0, 0], [60, 2, -6], [100, 8, -40], [80, 16, -90], [120, 24, -130], [70, 30, -170],
        [10, 30, -150], [-30, 24, -190], [-90, 18, -170], [-70, 12, -110], [-130, 8, -80], [-110, 2, -30], [-50, 0, 6],
      ],
      itemBoxes: boxes([0.08, 0.3, 0.5, 0.7, 0.9]),
      jumps: [{ t: 0.42, power: 1.2 }, { t: 0.82, power: 1 }],
      checkpoints: CHECKPOINTS,
      theme: {
        sky: '#3a1a1a', fog: '#5a2a1e', fogNear: 110, fogFar: 340,
        ground: '#3b2f2f', groundNoise: '#1e1414', hills: '#4a2b22', road: '#2e2a2a', dust: '#7a5a4a', lava: true,
        trees: ['tree_thin', 'tree_cone'], rocks: ['rock_largeA', 'rock_largeB', 'rock_tallA', 'rock_tallB'], flowers: [], extras: ['rock_smallA'], grass: null,
        sun: '#ffb37a', sunIntensity: 1.6, time: 'sunset',
      },
    },
  };
  exports.MAP_IDS = Object.keys(exports.MAPS);
  exports.DEFAULT_MAP = 'meadow';
  exports.ITEM_BOX_RESPAWN_MS = 4000;
  exports.VARIANTS = {
    time: [{ id: 'day', name: '白天' }, { id: 'sunset', name: '黃昏' }, { id: 'night', name: '夜晚' }],
    weather: [{ id: 'clear', name: '晴朗' }, { id: 'rain', name: '下雨' }, { id: 'snow', name: '下雪' }],
  };
  exports.DIFFICULTIES = [{ id: 'easy', name: '簡單' }, { id: 'normal', name: '普通' }, { id: 'hard', name: '困難' }];
  exports.BOT_NAMES = ['小龜', '阿鐵', '閃電', '香蕉哥', '飛毛腿', '老司機', '甩尾王', '路霸'];

  exports.CHARACTERS = [
    { id: 'mario', model: 'male-a', name: '瑪利歐', color: '#e52521', hat: 'cap', hatColor: '#e52521', letter: 'M' },
    { id: 'luigi', model: 'male-b', name: '路易吉', color: '#43b047', hat: 'cap', hatColor: '#43b047', letter: 'L' },
    { id: 'peach', model: 'female-a', name: '碧姬公主', color: '#f7a1c4', hat: 'crown', hatColor: '#ffd700' },
    { id: 'yoshi', model: 'male-c', name: '耀西', color: '#63d34d', hat: 'crest', hatColor: '#e52521' },
    { id: 'toad', model: 'female-b', name: '奇諾比奧', color: '#f0f0f0', hat: 'mushroom', hatColor: '#ffffff', spots: '#e52521' },
    { id: 'bowser', model: 'male-d', name: '庫巴', color: '#f2a300', hat: 'spikes', hatColor: '#e52521' },
    { id: 'dk', model: 'male-e', name: '森喜剛', color: '#8b4513', hat: 'tie', hatColor: '#e52521' },
    { id: 'wario', model: 'male-f', name: '瓦利歐', color: '#f2e100', hat: 'cap', hatColor: '#f2e100', letter: 'W' },
  ];

  /* 車種數值（經 tools/balance.mjs 以 AI 跑圈校正，各車單圈差距約 3% 以內）
   * maxSpeed 極速、accel 加速、turn 轉向速率、drift 漂移時的轉向倍率、offroad 出界保留速度比、weight 碰撞重量 */
  exports.KARTS = [
    { id: 'standard', name: '卡丁車', emoji: '🏎️', desc: '各項均衡，漂移好上手', maxSpeed: 44, accel: 24, turn: 2.3, drift: 1.35, offroad: 0.5, weight: 1.0 },
    { id: 'sport', name: 'F1 賽車', emoji: '🏁', desc: '極速最高、加速較慢、轉向偏鈍', maxSpeed: 49, accel: 20, turn: 2.0, drift: 1.25, offroad: 0.4, weight: 0.9 },
    { id: 'offroad', name: '越野 SUV', emoji: '🚙', desc: '出界幾乎不減速、耐撞', maxSpeed: 43, accel: 23, turn: 2.15, drift: 1.2, offroad: 0.9, weight: 1.3 },
    { id: 'bike', name: '未來賽車', emoji: '🚀', desc: '轉向最靈活、漂移蓄力最快', maxSpeed: 45, accel: 27, turn: 2.75, drift: 1.5, offroad: 0.45, weight: 0.8, driftCharge: 1.25 },
    { id: 'monster', name: '拖拉機', emoji: '🚜', desc: '極速最低，但撞人會把對方撞飛', maxSpeed: 42, accel: 22, turn: 2.0, drift: 1.15, offroad: 0.85, weight: 1.8, heavy: true },
  ];

  /* 道具：count 為一次拿到的數量；throwable 可前後投擲；trail 可拖在車後當盾 */
  exports.ITEMS = {
    mushroom: { name: '蘑菇', emoji: '🍄', desc: '加速衝刺 1.5 秒' },
    golden: { name: '金蘑菇', emoji: '🌟🍄', desc: '6 秒內可連續衝刺' },
    banana: { name: '香蕉', emoji: '🍌', desc: '丟在身後（按住往前丟），踩到的人打滑；可拖在車後擋龜殼', throwable: true, trail: true },
    tripleBanana: { name: '三根香蕉', emoji: '🍌×3', desc: '三根香蕉', count: 3, uses: 'banana', throwable: true, trail: true },
    green: { name: '綠龜殼', emoji: '🐢', desc: '直線射出並反彈，可往後丟', throwable: true, trail: true },
    tripleGreen: { name: '三綠殼', emoji: '🐢×3', desc: '三顆綠龜殼', count: 3, uses: 'green', throwable: true, trail: true },
    red: { name: '紅龜殼', emoji: '🔴', desc: '自動追蹤前方最近的對手', throwable: true, trail: true },
    tripleRed: { name: '三紅殼', emoji: '🔴×3', desc: '三顆紅龜殼', count: 3, uses: 'red', throwable: true, trail: true },
    blue: { name: '藍龜殼', emoji: '🔵', desc: '沿賽道飛向第一名並爆炸' },
    bomb: { name: '炸彈', emoji: '💣', desc: '丟出後爆炸，波及範圍內所有人', throwable: true },
    lightning: { name: '閃電', emoji: '⚡', desc: '所有對手打滑並減速 3 秒' },
    star: { name: '無敵星星', emoji: '⭐', desc: '6 秒無敵並加速' },
  };

  exports.DURATIONS = {
    spinMs: 1400,
    boostMs: 1500,
    goldenMs: 6000,
    starMs: 6000,
    slowMs: 3000,
    countdownMs: 4000,
    finishGraceMs: 40000,
    rouletteMs: 1300,
  };

  exports.DRIFT = {
    minSpeed: 14,
    levels: [1.0, 2.0, 3.1], // 秒：藍 / 橘 / 紫
    boostMs: [520, 1000, 1600],
    boostMul: [1.28, 1.34, 1.42],
    colors: ['#4fc3f7', '#ffa726', '#e040fb'],
  };
})(typeof module !== 'undefined' ? module.exports : (window.DEFS = {}));
