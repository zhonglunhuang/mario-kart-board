/* Service Worker：版本化快取。
 * - 版本號由伺服器在提供 /sw.js 時注入（部署時的 git 版本），版本改變 → 新 worker 安裝 → 客戶端提示更新
 * - 程式檔（html / js / css）：網路優先，離線時退回快取
 * - 模型 / 音效 / three.js / 圖示：快取優先（依版本分桶，舊版桶在啟用時清除）
 * - Socket.IO / API 一律不經快取 */
const VERSION = '__VERSION__';
const CACHE = `mkb-${VERSION}`;
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');

const STATIC_FIRST = [`${BASE}/models/`, `${BASE}/audio/`, `${BASE}/vendor/`, `${BASE}/icons/`];
const BYPASS = [`${BASE}/socket.io/`, `${BASE}/ice`, `${BASE}/config`, `${BASE}/healthz`, `${BASE}/sw.js`];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([`${BASE}/`, `${BASE}/style.css`, `${BASE}/manifest.webmanifest`]).catch(() => {})),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('mkb-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'GET_VERSION' && e.source) e.source.postMessage({ type: 'VERSION', version: VERSION });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (BYPASS.some((p) => url.pathname.startsWith(p))) return;

  if (STATIC_FIRST.some((p) => url.pathname.startsWith(p))) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // 網路優先（程式檔），失敗才用快取
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await c.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') return c.match(`${BASE}/`);
        throw err;
      }
    }),
  );
});
