# 🏁 賽車 Online

多人連線的 3D 即時競速賽車。開房間、看房間列表、選角色與車種，用手機或電腦打開瀏覽器就能直接玩。

- **後端**：Node.js + Express + Socket.IO（房間管理、倒數、圈數/檢查點、排名、道具與命中裁判、每秒 20 次狀態同步）
- **前端**：Three.js、原生 JS；街機風車輛物理在客戶端執行；手機優先版面（觸控轉向、自動油門）；PWA 可加到主畫面
- **3D 模型**：[Kenney](https://kenney.nl) 的 Car Kit、Mini Characters、Nature Kit、Racing Kit（CC0 授權，可商用）；車身依角色顏色做色相變換
- **部署**：Hostinger VPS（Ubuntu）掛在 `http://主機/mario/` 子路徑，systemd + Nginx 反向代理；也提供 Docker / PM2 設定

**線上遊玩**：https://187-127-206-177.sslip.io/mario/ （HTTPS；語音對話需要 HTTPS）

## 玩法

1. 輸入暱稱、選角色（8 位）與車種（卡丁車、F1 賽車、越野 SUV、未來賽車、拖拉機，各有極速 / 加速 / 轉向 / 越野數值）。
2. 在大廳開房間（賽道、圈數、人數上限、電腦車手數與難度）或加入別人的房間；房主可再調整逆向 / 鏡像 / 時間（白天、黃昏、夜晚）/ 天氣（晴、雨、雪）。全員按「準備」後房主開始。
3. 六張賽道：🌳 綠野賽道、🏜️ 峽谷沙漠、🏔️ 雪山高地、🌃 港灣夜城、🏖️ 陽光海灘、🌋 熔岩火山，每張都有跳台與不同主題。
4. 倒數 3 秒後起跑。**漂移**：轉彎時按住漂移鍵，火花由藍→橘→紫，放開就獲得對應等級的加速。跳台與山頂會騰空，落地有衝擊；撞護欄會反彈；車與車碰撞依重量互推。
5. 撿道具箱後會轉輪盤，落後者拿到更強的道具；可拖著香蕉或龜殼在車後擋攻擊，按住煞車再丟可往後丟。先跑完指定圈數者獲勝，第一名完賽後其他人有 40 秒完成。
6. 一個人也能玩：加入最多 7 位電腦車手（簡單 / 普通 / 困難），電腦會漂移、撿道具、丟龜殼，並有橡皮筋機制讓比賽保持緊湊。

| 道具 | 效果 |
| --- | --- |
| 🍄 蘑菇 / 🌟🍄 金蘑菇 | 加速衝刺；金蘑菇 6 秒內可連續衝刺 |
| 🍌 香蕉 / ×3 | 丟在身後（或往前丟），踩到的人打滑；可拖在車後當盾 |
| 🐢 綠龜殼 / ×3 | 直線射出並在護欄反彈，可往後丟 |
| 🔴 紅龜殼 / ×3 | 自動追蹤前方最近的對手 |
| 🔵 藍龜殼 | 沿賽道飛向第一名並爆炸 |
| 💣 炸彈 | 丟出後落地爆炸，波及範圍內所有人 |
| ⚡ 閃電 | 所有對手打滑並減速 3 秒 |
| ⭐ 無敵星星 | 6 秒無敵並加速 |

操作：電腦用 ← → 轉向、↑ 油門、↓ 煞車、Shift / X 漂移、空白鍵道具（按住拖曳、放開丟出）、C 看後方；手機用左下虛擬搖桿（可切換成 ◀ ▶ 按鈕）、右下漂移 / 道具 / 往後丟 / 煞車，預設自動油門。手機開賽時會嘗試鎖定橫向（Android），iPhone 會顯示旋轉提示。

- **視覺**：漂移火花與輪胎痕、排氣與加速火焰、出界揚塵、道具箱破碎、爆炸與閃電白光、無敵星星彩色粒子；角色有帽子 / 皇冠 / 蘑菇頭等專屬配件，被擊中、騰空、勝負都有動作；鏡頭隨速度拉大視野、被擊中與落地會震動、可看後方、起跑前環繞運鏡；夜晚有路燈、車頭燈與星空，雨天路面反光；桌機高畫質有 bloom 與 SMAA 後製，可在說明面板切換畫質。
- **道具顯示**：右下角大格子（手機為 🎁 按鈕）顯示目前道具與說明，排名面板也看得到每位玩家手上的道具。
- **音效與音樂**：撞擊、撿箱、介面音使用 Kenney CC0 取樣；三層引擎聲含換檔與風聲、漂移摩擦聲、加速、爆炸、雷聲以 WebAudio 合成；大廳 / 比賽 / 最後一圈 / 完賽有程序化背景音樂（可關）；倒數、圈數、道具、完賽以中文 TTS 播報。
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
public/js/track.js     賽道幾何（Catmull-Rom 等弧長取樣、曲率、跳台、逆向 / 鏡像），瀏覽器與 Node 共用
public/js/kart-physics.js 街機物理：加速 / 轉向 / 漂移蓄力 / 跳台騰空 / 撞牆反彈 / 車車碰撞
public/js/ai.js        AI 車手：目標追蹤、彎道漂移、閃避、撿道具箱、道具使用、難度與橡皮筋
public/js/particles.js 粒子系統、天氣、輪胎痕
public/js/race.js      比賽控制器：本地車、房主模擬 AI、輸入（鍵盤 / 觸控 / 搖桿）、道具與投射物、特效、HUD、小地圖、同步
tools/balance.mjs      平衡測試：AI 在每張地圖用每種車跑圈，輸出單圈時間與車種差距
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
- 電腦車手由房主的瀏覽器模擬（同一套物理與 AI），房主離開時自動由新房主接手。
- 道具箱、道具效果、命中判定由伺服器決定（龜殼、炸彈、藍殼的飛行由發射者的客戶端模擬並回報命中）。
- 平衡：`node tools/balance.mjs hard 2` 會用 AI 跑遍六張地圖 × 五種車，目前車種單圈差距 5% 到 9%。

## 注意事項

- 房間狀態在記憶體中，重啟伺服器會清空；請保持單一 Node 實例。
- 玩家斷線會被判定退出比賽，目前不支援斷線後接回原局。
- 角色名稱僅為致敬；模型皆為 Kenney CC0 素材。若要公開商用，建議改用自己的角色名稱。
