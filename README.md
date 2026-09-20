# 🏁 賽車桌遊 Online

多人連線的 3D 賽車桌遊。開房間、看房間列表、選角色與車種，用手機或電腦打開瀏覽器就能直接玩。

- **後端**：Node.js + Express + Socket.IO（伺服器權威的回合制規則）
- **前端**：Three.js（程序化生成的低多邊形賽道、角色、車輛，不含任何版權素材）、原生 JS、手機優先版面、PWA 可加到主畫面
- **部署**：Hostinger VPS（Ubuntu）掛在 `http://主機/mario/` 子路徑，systemd + Nginx 反向代理；也提供 Docker / PM2 設定

## 玩法

1. 輸入暱稱、選角色（瑪利歐、路易吉、碧姬、耀西、奇諾比奧、庫巴、森喜剛、瓦利歐）與車種。
2. 在大廳開房間（設定圈數、人數上限）或加入別人的房間；全員按「準備」後房主開始。
3. 輪到你時可以先用一個道具，再擲骰子前進；先跑完指定圈數的人獲勝。逾時（預設 45 秒）自動擲骰。

| 格子 | 效果 |
| --- | --- |
| 🎁 道具箱 | 獲得隨機道具，落後者拿到更強的道具 |
| 🔥 加速板 | 再前進 2 格 |
| 🛢️ 油漬 | 下一回合暫停（越野車免疫） |
| 🌟 星星格 | 再擲一次骰子 |
| 停在別人的格子 | 對方被撞退 1 格（大腳車 2 格） |

道具：🍄 蘑菇（+3）、🍌 香蕉（放置陷阱）、🐢 綠龜殼（隨機對手 −3）、🔴 紅龜殼（前方最近對手 −4）、🔵 藍龜殼（領先者 −5）、⚡ 閃電（全部對手 −2）、⭐ 無敵星星（兩回合免疫、擲骰 +2）。

車種能力：跑車（擲 6 額外 +1）、越野車（免疫油漬與香蕉）、摩托車（拿道具 50% 多一個）、大腳車（撞人退 2 格）、標準賽車（無）。

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
| `TURN_SECONDS` | `45` | 每回合秒數，逾時自動擲骰 |

測試（啟動伺服器、兩個客戶端打完一整場）：

```bash
npm test
```

## 部署到 Hostinger VPS

前提：本機能以 SSH 金鑰登入 VPS（`ssh root@你的IP`）。

```bash
./deploy/deploy.sh root@187.127.206.177
```

腳本會：

1. `rsync` 專案到 `/srv/mario-kart-board`
2. 主機上 `npm ci --omit=dev`（沒有 Node 會自動安裝 Node 20）
3. 安裝並啟動 systemd 服務 `mario-kart`（port 3100，`BASE_PATH=/mario`）
4. 把 `deploy/nginx-mario.conf` 裝到 `/etc/nginx/snippets/mario.conf`，並 `include` 進既有站台的 `server {}`（會先備份原檔）；沒有既有站台時建立獨立站台
5. `nginx -t` 後 reload，檢查 `/mario/healthz`

完成後用 `http://你的IP/mario/` 開啟。之後更新程式只要再跑一次同樣的指令。

常用指令（在 VPS 上）：

```bash
systemctl status mario-kart        # 服務狀態
journalctl -u mario-kart -f        # 即時 log
systemctl restart mario-kart       # 重啟
```

### HTTPS

有網域後，在 VPS 上執行 `certbot --nginx -d 你的網域`，certbot 會自動改寫 Nginx 設定；Socket.IO 會自動走 `wss://`。

### Docker 替代方案

```bash
docker compose up -d --build     # 服務在 127.0.0.1:3100
```

再把 `deploy/nginx-mario.conf` include 進 Nginx 即可。

### PM2 替代方案

```bash
npm i -g pm2
pm2 start ecosystem.config.js && pm2 save && pm2 startup
```

## 專案結構

```
server/index.js      HTTP + Socket.IO 進入點（base path、靜態檔、事件路由）
server/rooms.js      玩家 / 房間管理（建立、加入、準備、開始、離開）
server/game.js       遊戲規則引擎（擲骰、移動、格子效果、道具、名次、回合計時）
public/shared/defs.js 角色、車種、道具、賽道定義（前後端共用）
public/js/main.js    UI 流程、Socket 事件、動畫佇列、HUD
public/js/scene.js   Three.js 場景：賽道、鏡頭跟隨、移動動畫
public/js/characters.js 程序化角色 / 車輛 / 道具模型
deploy/              nginx、systemd、部署腳本
test/e2e.test.js     端對端測試
```

## 注意事項

- 遊戲狀態存在記憶體中，重啟伺服器會清空房間；請保持單一 Node 實例（不要開多個 worker）。
- 玩家斷線會被判定退出比賽（目前不支援斷線重連接回原局）。
- 角色名稱僅為致敬，所有 3D 模型皆為程式生成的原創幾何體。若要公開商用，建議改用自己的角色名稱。
