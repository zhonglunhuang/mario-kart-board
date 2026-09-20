/* 伺服器與瀏覽器共用的遊戲定義 */
(function (exports) {
  // 賽道控制點（封閉曲線，客戶端用 CatmullRom 生成道路；伺服器只用「進度 t」判定圈數）
  exports.TRACK = {
    controlPoints: [
      [0, 0, 0], [60, 0, -4], [110, 1, -30], [130, 6, -85], [100, 12, -145], [35, 12, -165],
      [-40, 9, -155], [-90, 4, -115], [-140, 1, -70], [-125, 0, -15], [-75, 0, 12], [-30, 0, 8],
    ],
    width: 18, // 路面總寬
    laps: 3,
    // 道具箱位置：t = 賽道進度，lane = 橫向偏移（-1..1）
    itemBoxes: [
      { t: 0.08, lane: -0.6 }, { t: 0.08, lane: 0 }, { t: 0.08, lane: 0.6 },
      { t: 0.31, lane: -0.6 }, { t: 0.31, lane: 0 }, { t: 0.31, lane: 0.6 },
      { t: 0.55, lane: -0.6 }, { t: 0.55, lane: 0 }, { t: 0.55, lane: 0.6 },
      { t: 0.8, lane: -0.6 }, { t: 0.8, lane: 0 }, { t: 0.8, lane: 0.6 },
    ],
    checkpoints: [0.25, 0.5, 0.75],
    itemBoxRespawnMs: 4000,
  };

  exports.CHARACTERS = [
    { id: 'mario', model: 'male-a', name: '瑪利歐', color: '#e52521', hat: 'cap', hatColor: '#e52521', shirt: '#1560bd', mustache: true, skin: '#f5c9a4' },
    { id: 'luigi', model: 'male-b', name: '路易吉', color: '#43b047', hat: 'cap', hatColor: '#43b047', shirt: '#1560bd', mustache: true, skin: '#f5c9a4' },
    { id: 'peach', model: 'female-a', name: '碧姬公主', color: '#f7a1c4', hat: 'crown', hatColor: '#ffd700', shirt: '#f7a1c4', hair: '#ffe066', skin: '#f9dcc4' },
    { id: 'yoshi', model: 'male-c', name: '耀西', color: '#63d34d', hat: 'none', shirt: '#ffffff', skin: '#63d34d', snout: true },
    { id: 'toad', model: 'female-b', name: '奇諾比奧', color: '#f0f0f0', hat: 'mushroom', hatColor: '#ffffff', spots: '#e52521', shirt: '#1e90ff', skin: '#f9dcc4' },
    { id: 'bowser', model: 'male-d', name: '庫巴', color: '#f2a300', hat: 'spikes', hatColor: '#e52521', shirt: '#4caf50', skin: '#8bc34a', bigger: true },
    { id: 'dk', model: 'male-e', name: '森喜剛', color: '#8b4513', hat: 'none', shirt: '#8b4513', skin: '#8b4513', tie: '#e52521', bigger: true },
    { id: 'wario', model: 'male-f', name: '瓦利歐', color: '#f2e100', hat: 'cap', hatColor: '#f2e100', shirt: '#7b1fa2', mustache: true, skin: '#f5c9a4' },
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
