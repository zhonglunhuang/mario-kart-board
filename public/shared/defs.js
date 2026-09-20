/* 伺服器與瀏覽器共用的遊戲定義 */
(function (exports) {
  const CHECKPOINTS = [0.25, 0.5, 0.75];
  const boxes = (ts) => ts.flatMap((t) => [-0.6, 0, 0.6].map((lane) => ({ t, lane })));

  // 地圖：controlPoints 為封閉曲線的控制點（客戶端用 CatmullRom 生成道路）
  exports.MAPS = {
    meadow: {
      id: 'meadow',
      name: '綠野賽道',
      emoji: '🌳',
      desc: '平坦寬闊，適合新手',
      difficulty: 1,
      width: 18,
      controlPoints: [
        [0, 0, 0], [60, 0, -4], [110, 1, -30], [130, 6, -85], [100, 12, -145], [35, 12, -165],
        [-40, 9, -155], [-90, 4, -115], [-140, 1, -70], [-125, 0, -15], [-75, 0, 12], [-30, 0, 8],
      ],
      itemBoxes: boxes([0.08, 0.31, 0.55, 0.8]),
      checkpoints: CHECKPOINTS,
      theme: {
        sky: '#8fd3ff', fog: '#a9dcff', fogNear: 170, fogFar: 460,
        ground: '#5fae3f', groundNoise: '#2f6b20', hills: '#4e8f3f', road: '#3b3b44',
        trees: ['tree_default', 'tree_detailed', 'tree_oak', 'tree_pineDefaultA', 'tree_pineRoundA'],
        rocks: ['rock_largeA', 'rock_largeB'],
        flowers: ['flower_redA', 'flower_yellowA', 'flower_purpleA'],
        extras: ['mushroom_red', 'mushroom_tan'],
        grass: 'grass_large',
        sun: '#fff4d6', sunIntensity: 1.9,
      },
    },
    canyon: {
      id: 'canyon',
      name: '峽谷沙漠',
      emoji: '🏜️',
      desc: '髮夾彎與 S 型連續彎，難度中等',
      difficulty: 2,
      width: 16,
      controlPoints: [
        [0, 0, 0], [70, 0, -5], [120, 3, -30], [150, 8, -80], [125, 14, -125], [78, 14, -108],
        [36, 10, -145], [62, 6, -195], [20, 4, -228], [-45, 2, -205], [-62, 6, -152], [-112, 10, -132],
        [-152, 6, -80], [-132, 2, -30], [-82, 0, -5], [-30, 0, 3],
      ],
      itemBoxes: boxes([0.07, 0.24, 0.42, 0.6, 0.78, 0.93]),
      checkpoints: CHECKPOINTS,
      theme: {
        sky: '#ffcf8a', fog: '#f5c98f', fogNear: 150, fogFar: 420,
        ground: '#e0b96a', groundNoise: '#a8783a', hills: '#c2703f', road: '#4a4038',
        trees: ['tree_palm', 'tree_palmDetailedShort', 'tree_palm'],
        rocks: ['rock_tallA', 'rock_tallB', 'rock_largeA', 'rock_largeB'],
        flowers: ['flower_yellowA'],
        extras: ['rock_smallA'],
        grass: 'grass_large',
        sun: '#ffe2b0', sunIntensity: 2.2,
      },
    },
    alpine: {
      id: 'alpine',
      name: '雪山高地',
      emoji: '🏔️',
      desc: '大幅爬升與下坡，窄路高難度',
      difficulty: 3,
      width: 14,
      controlPoints: [
        [0, 0, 0], [50, 2, -10], [92, 10, -42], [102, 22, -92], [72, 32, -132], [20, 36, -152],
        [-32, 34, -132], [-22, 26, -92], [-62, 20, -72], [-112, 14, -92], [-132, 8, -42], [-92, 2, -10], [-40, 0, 2],
      ],
      itemBoxes: boxes([0.1, 0.3, 0.52, 0.72, 0.9]),
      checkpoints: CHECKPOINTS,
      theme: {
        sky: '#cfe6ff', fog: '#e6f1ff', fogNear: 120, fogFar: 380,
        ground: '#f2f6fa', groundNoise: '#b9c9d8', hills: '#dfe9f2', road: '#4b4f58',
        trees: ['tree_pineTallA', 'tree_pineDefaultA', 'tree_pineSmallA', 'tree_cone'],
        rocks: ['rock_largeA', 'rock_tallA'],
        flowers: [],
        extras: ['rock_smallA'],
        grass: null,
        sun: '#ffffff', sunIntensity: 1.7,
      },
    },
  };
  exports.MAP_IDS = Object.keys(exports.MAPS);
  exports.DEFAULT_MAP = 'meadow';
  exports.ITEM_BOX_RESPAWN_MS = 4000;

  exports.CHARACTERS = [
    { id: 'mario', model: 'male-a', name: '瑪利歐', color: '#e52521' },
    { id: 'luigi', model: 'male-b', name: '路易吉', color: '#43b047' },
    { id: 'peach', model: 'female-a', name: '碧姬公主', color: '#f7a1c4' },
    { id: 'yoshi', model: 'male-c', name: '耀西', color: '#63d34d' },
    { id: 'toad', model: 'female-b', name: '奇諾比奧', color: '#f0f0f0' },
    { id: 'bowser', model: 'male-d', name: '庫巴', color: '#f2a300' },
    { id: 'dk', model: 'male-e', name: '森喜剛', color: '#8b4513' },
    { id: 'wario', model: 'male-f', name: '瓦利歐', color: '#f2e100' },
  ];

  // 車種數值：maxSpeed 極速、accel 加速度、turn 轉向速率、offroad 出界後保留的速度比例
  exports.KARTS = [
    { id: 'standard', name: '卡丁車', emoji: '🏎️', desc: '各項均衡', maxSpeed: 44, accel: 24, turn: 2.3, offroad: 0.5 },
    { id: 'sport', name: 'F1 賽車', emoji: '🏁', desc: '極速最高、加速較慢、轉向偏鈍', maxSpeed: 50, accel: 19, turn: 1.95, offroad: 0.4 },
    { id: 'offroad', name: '越野 SUV', emoji: '🚙', desc: '出界幾乎不減速', maxSpeed: 41, accel: 24, turn: 2.2, offroad: 0.9 },
    { id: 'bike', name: '未來賽車', emoji: '🚀', desc: '轉向最靈活、加速快', maxSpeed: 45, accel: 27, turn: 2.8, offroad: 0.45 },
    { id: 'monster', name: '拖拉機', emoji: '🚜', desc: '極速最低，但撞人會把對方撞飛', maxSpeed: 39, accel: 22, turn: 2.0, offroad: 0.85, heavy: true },
  ];

  exports.ITEMS = {
    mushroom: { name: '蘑菇', emoji: '🍄', desc: '加速衝刺 1.5 秒' },
    banana: { name: '香蕉', emoji: '🍌', desc: '丟在身後，踩到的人打滑' },
    green: { name: '綠龜殼', emoji: '🐢', desc: '直線射出，打中的人打滑' },
    red: { name: '紅龜殼', emoji: '🔴', desc: '自動追蹤前方最近的對手' },
    lightning: { name: '閃電', emoji: '⚡', desc: '所有對手打滑並減速 3 秒' },
    star: { name: '無敵星星', emoji: '⭐', desc: '6 秒無敵並加速' },
  };

  exports.DURATIONS = {
    spinMs: 1400,
    boostMs: 1500,
    starMs: 6000,
    slowMs: 3000,
    countdownMs: 4000,
    finishGraceMs: 40000, // 第一名完賽後其他人的寬限時間
  };
})(typeof module !== 'undefined' ? module.exports : (window.DEFS = {}));
