# 🏁 賽車 Online

多人連線的 3D 即時競速賽車。開房間、看房間列表、選角色與車種，用手機或電腦打開瀏覽器就能直接玩。

- **後端**：Node.js + Express + Socket.IO（房間管理、倒數、圈數/檢查點、排名、道具與命中裁判、每秒 20 次狀態同步）
- **前端**：Three.js、原生 JS；街機風車輛物理在客戶端執行；手機優先版面（觸控轉向、自動油門）；PWA 可加到主畫面
- **3D 模型**：[Kenney](https://kenney.nl) 的 Car Kit、Mini Characters、Nature Kit、Racing Kit（CC0 授權，可商用）；車身依角色顏色做色相變換
- **部署**：Hostinger VPS（Ubuntu）掛在 `http://主機/mario/` 子路徑，systemd + Nginx 反向代理；也提供 Docker / PM2 設定

**線上遊玩**：https://187-127-206-177.sslip.io/mario/ （HTTPS；語音對話需要 HTTPS）

## 玩法

1. 輸入暱稱、選角色（8 位）與車種（卡丁車、F1 賽車、越野 SUV、未來賽車、拖拉機，各有極速 / 加速 / 轉向 / 越野數值）。
2. 在大廳開房間（賽道、圈數、人數上限）或加入別人的房間；全員按「準備」後房主開始。賽道有三張：🌳 綠野賽道（簡單）、🏜️ 峽谷沙漠（髮夾彎、S 彎）、🏔️ 雪山高地（大爬升、窄路）。
3. 倒數 3 秒後起跑。撞到護欄會減速、開上草地會變慢、撞到別人會互相推擠。
4. 撿賽道上的道具箱拿道具，落後者會拿到更強的道具；先跑完指定圈數者獲勝，第一名完賽後其他人有 40 秒完成。

| 道具 | 效果 |
| --- | --- |
| 🍄 蘑菇 | 加速衝刺 1.5 秒 |
| 🍌 香蕉 | 丟在身後，踩到的人打滑 |
| 🐢 綠龜殼 | 直線射出並會在護欄反彈，打中的人打滑 |
| 🔴 紅龜殼 | 自動追蹤前方最近的對手 |
| ⚡ 閃電 | 所有對手打滑並減速 3 秒 |
| ⭐ 無敵星星 | 6 秒無敵並加速 |

操作：電腦用 ← → 轉向、↑ 油門、↓ 煞車 / 倒車、空白鍵使用道具；手機用左下 ◀ ▶ 轉向、右下道具 / 煞車，預設自動油門（可關）。

- **道具顯示**：右下角大格子（手機為 🎁 按鈕）顯示目前道具與說明，排名面板也看得到每位玩家手上的道具。
- **音效與播報**：引擎聲、倒數、撿道具、擊中、完賽等音效由 WebAudio 即時合成（不需音檔）；倒數、圈數、拿到道具、完賽等由瀏覽器內建 TTS 用中文播報。HUD 的 🔊 可靜音，房間內可關閉播報。
- **語音對話**：房間或比賽中按 🎤 加入語音（WebRTC 點對點，Socket.IO 交換訊號，自架 coturn 作為 TURN 中繼）。瀏覽器要求 HTTPS 才能開麥克風。

## 本機執行

```bash
npm install
npm start
# 打開 http://localhost:3000/mario/
```

環境變數（見 `.env.example`）：

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `PORT` | `3000` | 監聽 port |
| `BASE_PATH` | `/mario` | 掛載的子路徑；要放在根路徑就設 `/` |

測試（啟動伺服器、兩個客戶端模擬跑完一整場）：

```bash
npm test
```

## 部署到 Hostinger VPS

前提：本機能以 SSH 金鑰登入 VPS。

```bash
./deploy/deploy.sh root@187.127.206.177
```

腳本會 `rsync` 專案到 `/srv/mario-kart-board`、`npm ci --omit=dev`、安裝並啟動 systemd 服務 `mario-kart`（port 3100，`BASE_PATH=/mario`）、把 `deploy/nginx-mario.conf` 裝成 Nginx snippet 並 include 進既有站台（會先備份到 `/etc/nginx/backup/`），最後 reload Nginx 並檢查 `/mario/healthz`。之後更新程式只要再跑一次同樣的指令。

常用指令（在 VPS 上）：

```bash
systemctl status mario-kart
journalctl -u mario-kart -f
systemctl restart mario-kart
```

### HTTPS 與語音

- 目前用 `187-127-206-177.sslip.io`（免費對應 IP 的網域）向 Let's Encrypt 取得憑證，設定在 `/etc/nginx/sites-enabled/mario-host`；certbot 會自動續期。用 IP 開啟 `/mario/` 會被 301 轉到 HTTPS 網址（`deploy/nginx-mario.conf`）。
- 有自己的網域時：DNS 指到 VPS 後執行 `certbot --nginx -d 你的網域`，並把 `/etc/mario-kart.env` 的 `PUBLIC_HTTPS_URL` 改掉。
- 語音中繼：VPS 上跑 coturn（`/etc/turnserver.conf`，port 3478 + UDP 49152–49400），Node 依 `/etc/mario-kart.env` 的 `TURN_SECRET` 簽發 12 小時暫時憑證（`GET /mario/ice`）。

### Docker / PM2 替代方案

```bash
docker compose up -d --build            # 服務在 127.0.0.1:3100
npm i -g pm2 && pm2 start ecosystem.config.js && pm2 save
```

## 專案結構

```
server/index.js        HTTP + Socket.IO 進入點（base path、靜態檔、事件路由）
server/rooms.js        玩家 / 房間管理（建立、加入、準備、開始、離開）
server/game.js         競速裁判：倒數、圈數/檢查點、排名、道具箱、道具效果、命中、完賽
public/shared/defs.js  三張地圖（控制點、寬度、主題）、角色、車種數值、道具、時間常數（前後端共用）
public/js/main.js      大廳 / 房間 UI、Socket 事件、載入流程
public/js/race.js      本地車輛物理、輸入（鍵盤 / 觸控）、龜殼模擬、狀態回報、HUD、小地圖
public/js/scene.js     Three.js 場景：賽道路面、護欄、看台、樹木（InstancedMesh）、鏡頭
public/js/models.js    glTF 模型載入、車輛色相變換、角色駕駛動畫、道具模型
public/js/audio.js     WebAudio 音效合成 + TTS 播報
public/js/voice.js     WebRTC 語音對話（mesh）
public/models/         Kenney CC0 模型（見 LICENSE.txt）
deploy/                nginx、systemd、部署腳本
test/e2e.test.js       端對端測試
```

## 同步方式

- 每位玩家的車由自己的瀏覽器模擬，每 50ms 回報位置、速度與賽道進度 `t`；伺服器以 `t` 判定檢查點與圈數並廣播全員快照，其他玩家的車以速度外推 + 平滑插值顯示。
- 道具箱、道具效果、命中判定由伺服器決定（龜殼的飛行由發射者的客戶端模擬並回報命中）。

## 注意事項

- 房間狀態在記憶體中，重啟伺服器會清空；請保持單一 Node 實例。
- 玩家斷線會被判定退出比賽，目前不支援斷線後接回原局。
- 角色名稱僅為致敬；模型皆為 Kenney CC0 素材。若要公開商用，建議改用自己的角色名稱。
