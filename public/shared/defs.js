/* 伺服器與瀏覽器共用的遊戲定義 */
(function (exports) {
  exports.TRACK_LENGTH = 40;

  const T = new Array(exports.TRACK_LENGTH).fill('normal');
  T[0] = 'start';
  [4, 11, 17, 23, 29, 35].forEach((i) => (T[i] = 'item'));
  [7, 20, 32].forEach((i) => (T[i] = 'boost'));
  [9, 15, 26, 37].forEach((i) => (T[i] = 'hazard'));
  [13, 30].forEach((i) => (T[i] = 'star'));
  exports.TILES = T;

  exports.TILE_INFO = {
    start: { name: '起點 / 終點', emoji: '🏁', desc: '每繞一圈經過這裡就完成一圈' },
    normal: { name: '一般格', emoji: '⬜', desc: '沒有效果' },
    item: { name: '道具箱', emoji: '🎁', desc: '停在這裡可獲得一個隨機道具（落後者拿到更強的道具）' },
    boost: { name: '加速板', emoji: '🔥', desc: '停在這裡再前進 2 格' },
    hazard: { name: '油漬', emoji: '🛢️', desc: '停在這裡下一回合暫停（越野車免疫）' },
    star: { name: '星星格', emoji: '🌟', desc: '停在這裡可以再擲一次骰子' },
  };

  exports.CHARACTERS = [
    { id: 'mario', name: '瑪利歐', color: '#e52521', hat: 'cap', hatColor: '#e52521', shirt: '#1560bd', mustache: true, skin: '#f5c9a4', letter: 'M' },
    { id: 'luigi', name: '路易吉', color: '#43b047', hat: 'cap', hatColor: '#43b047', shirt: '#1560bd', mustache: true, skin: '#f5c9a4', letter: 'L' },
    { id: 'peach', name: '碧姬公主', color: '#f7a1c4', hat: 'crown', hatColor: '#ffd700', shirt: '#f7a1c4', hair: '#ffe066', skin: '#f9dcc4' },
    { id: 'yoshi', name: '耀西', color: '#63d34d', hat: 'none', shirt: '#ffffff', skin: '#63d34d', snout: true },
    { id: 'toad', name: '奇諾比奧', color: '#f0f0f0', hat: 'mushroom', hatColor: '#ffffff', spots: '#e52521', shirt: '#1e90ff', skin: '#f9dcc4' },
    { id: 'bowser', name: '庫巴', color: '#f2a300', hat: 'spikes', hatColor: '#e52521', shirt: '#4caf50', skin: '#8bc34a', bigger: true },
    { id: 'dk', name: '森喜剛', color: '#8b4513', hat: 'none', shirt: '#8b4513', skin: '#8b4513', tie: '#e52521', bigger: true },
    { id: 'wario', name: '瓦利歐', color: '#f2e100', hat: 'cap', hatColor: '#f2e100', shirt: '#7b1fa2', mustache: true, skin: '#f5c9a4', letter: 'W' },
  ];

  exports.KARTS = [
    { id: 'standard', name: '標準賽車', emoji: '🏎️', desc: '均衡，沒有特殊能力' },
    { id: 'sport', name: '跑車', emoji: '🚗', desc: '擲出 6 時額外 +1 格' },
    { id: 'offroad', name: '越野車', emoji: '🚙', desc: '免疫油漬與香蕉' },
    { id: 'bike', name: '摩托車', emoji: '🏍️', desc: '拿道具時有 50% 機率多拿一個' },
    { id: 'monster', name: '大腳車', emoji: '🚜', desc: '撞到別人時把對方撞退 2 格（一般為 1 格）' },
  ];

  exports.ITEMS = {
    mushroom: { name: '蘑菇', emoji: '🍄', desc: '立刻前進 3 格' },
    banana: { name: '香蕉', emoji: '🍌', desc: '放在目前的格子，停在上面的人退 2 格' },
    green: { name: '綠龜殼', emoji: '🐢', desc: '隨機一位對手退 3 格' },
    red: { name: '紅龜殼', emoji: '🔴', desc: '前方最近的對手退 4 格' },
    blue: { name: '藍龜殼', emoji: '🔵', desc: '領先者退 5 格' },
    lightning: { name: '閃電', emoji: '⚡', desc: '所有對手退 2 格' },
    star: { name: '無敵星星', emoji: '⭐', desc: '兩回合免疫傷害，且擲骰 +2' },
  };

  exports.MAX_ITEMS = 2;
})(typeof module !== 'undefined' ? module.exports : (window.DEFS = {}));
