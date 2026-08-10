/* おうちネット Hub — Service Worker
   アプリシェルをキャッシュしてオフラインでも起動できるようにする。
   相対パスで登録するため、Flask（ルート配信）でも GitHub Pages
   （サブパス配信）でも同じコードで動作する。

   方針:
   - HTML/JS/CSS/manifest（アプリ本体）は「ネットワーク優先」。
     オンラインなら常に最新を取得するので、更新が即座に反映される
     （インストール済みPWAが古いコードのまま固まる問題を防ぐ）。
   - 画像/アイコンは「キャッシュ優先」（変化が少なく高速）。
   - /api/ はキャッシュしない（動的データ）。 */
const CACHE = "ouchi-hub-v2";
const ASSETS = [
  "./",
  "static/css/styles.css",
  "static/js/app.js",
  "static/js/kids.js",
  "manifest.webmanifest",
  "static/icons/icon-192.png",
  "static/icons/icon-512.png",
  "static/icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .catch(() => {})            // 一部取得失敗でもインストールは継続
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isShell(url) {
  // アプリ本体（HTML/JS/CSS/manifest）はネットワーク優先で最新を届ける
  return url.origin === self.location.origin && (
    url.pathname.endsWith("/") ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".webmanifest")
  );
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API はキャッシュ・介入しない（動的データ、ネットワーク直行）
  if (url.pathname.indexOf("/api/") !== -1) return;

  if (req.mode === "navigate" || isShell(url)) {
    // ネットワーク優先＋キャッシュ更新、失敗時はキャッシュ、無ければトップ
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("./")))
    );
    return;
  }

  // それ以外（画像・アイコン等）はキャッシュ優先＋ネットワーク補完
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match("./"));
    })
  );
});
