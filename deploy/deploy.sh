#!/usr/bin/env bash
# 一鍵部署到 Hostinger VPS（Ubuntu）：
#   ./deploy/deploy.sh root@187.127.206.177
#
# 做的事：
#   1. rsync 專案到 /srv/mario-kart-board（不含 node_modules / .git）
#   2. 主機上 npm ci --omit=dev
#   3. 安裝 systemd 服務 mario-kart（port 3100, base path /mario）
#   4. 安裝 nginx snippet 並 include 進既有的 server 區塊（或建立獨立站台）
#   5. 重新載入 nginx、重啟服務、檢查 /mario/healthz
set -euo pipefail

TARGET="${1:-root@187.127.206.177}"
REMOTE_DIR="${REMOTE_DIR:-/srv/mario-kart-board}"
SITE_FILE="${SITE_FILE:-}"   # 想 include 進哪個 nginx 站台檔；留空自動偵測 sites-enabled 中的第一個

HERE="$(cd "$(dirname "$0")/.." && pwd)"

# 版本號（給 PWA service worker 判斷是否有新版）
printf '%s-%s\n' "$(git -C "$HERE" rev-parse --short HEAD 2>/dev/null || echo nogit)" "$(date +%Y%m%d%H%M)" > "$HERE/VERSION"
echo "==> 版本 $(cat "$HERE/VERSION")"
# 有比賽進行中就先等（最多 10 分鐘），避免重啟切斷玩家；FORCE=1 可略過
if [ "${FORCE:-0}" != "1" ]; then
  for i in $(seq 1 40); do
    PLAYING=$(ssh "$TARGET" "curl -s -m 5 http://127.0.0.1/mario/healthz" 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("playing",0))' 2>/dev/null || echo 0)
    if [ "${PLAYING:-0}" = "0" ]; then break; fi
    echo "   目前有 $PLAYING 場比賽進行中，等待 15 秒後再檢查（第 $i 次）..."
    sleep 15
  done
fi
echo "==> [1/5] 上傳程式碼到 $TARGET:$REMOTE_DIR"
ssh "$TARGET" "mkdir -p '$REMOTE_DIR'"
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude .claude --exclude test --exclude data \
  "$HERE/" "$TARGET:$REMOTE_DIR/"

echo "==> [2/5] 安裝相依套件 / 服務 / nginx 設定"
ssh "$TARGET" bash -s -- "$REMOTE_DIR" "${SITE_FILE:-auto}" <<'REMOTE'
set -euo pipefail
REMOTE_DIR="$1"
SITE_FILE="$2"; [ "$SITE_FILE" = "auto" ] && SITE_FILE=""

if ! command -v node >/dev/null 2>&1; then
  echo "   安裝 Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
if ! command -v nginx >/dev/null 2>&1; then
  echo "   安裝 nginx..."
  apt-get update && apt-get install -y nginx
fi

cd "$REMOTE_DIR"
npm ci --omit=dev --no-audit --no-fund
mkdir -p "$REMOTE_DIR/data"
chown -R www-data:www-data "$REMOTE_DIR"

echo "==> [3/5] systemd 服務"
install -m 644 deploy/mario-kart.service /etc/systemd/system/mario-kart.service
systemctl daemon-reload
systemctl enable mario-kart >/dev/null 2>&1 || true
systemctl restart mario-kart

echo "==> [4/5] nginx"
mkdir -p /etc/nginx/snippets
install -m 644 deploy/nginx-mario.conf /etc/nginx/snippets/mario.conf

if [ -z "$SITE_FILE" ]; then
  SITE_FILE="$(ls /etc/nginx/sites-enabled/ 2>/dev/null | head -n1 || true)"
  [ -n "$SITE_FILE" ] && SITE_FILE="/etc/nginx/sites-enabled/$SITE_FILE"
fi

if [ -n "$SITE_FILE" ] && [ -f "$SITE_FILE" ]; then
  if ! grep -q "snippets/mario.conf" "$SITE_FILE"; then
    # 備份放到 sites-enabled 之外，否則 nginx 會把備份檔也載入
    mkdir -p /etc/nginx/backup
    cp "$SITE_FILE" "/etc/nginx/backup/$(basename "$SITE_FILE").bak.$(date +%s)"
    # 在第一個 "server {" 之後插入 include
    awk 'BEGIN{done=0} { print } /^[[:space:]]*server[[:space:]]*\{/ && !done { print "    include snippets/mario.conf;"; done=1 }' "$SITE_FILE" > "$SITE_FILE.tmp"
    mv "$SITE_FILE.tmp" "$SITE_FILE"
    echo "   已在 $SITE_FILE 加入 include snippets/mario.conf"
  else
    echo "   $SITE_FILE 已包含 mario snippet"
  fi
else
  echo "   找不到既有站台，建立獨立站台 /etc/nginx/sites-available/mario"
  install -m 644 deploy/nginx-standalone.conf /etc/nginx/sites-available/mario
  ln -sf /etc/nginx/sites-available/mario /etc/nginx/sites-enabled/mario
  rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl reload nginx

echo "==> [5/5] 健康檢查"
sleep 1
systemctl --no-pager --lines=5 status mario-kart | head -n 8
curl -fsS http://127.0.0.1/mario/healthz && echo
REMOTE

HOST="${TARGET#*@}"
echo
echo "✅ 部署完成：http://$HOST/mario/"
