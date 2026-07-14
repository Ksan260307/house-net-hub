/* おうちネット Hub — Service Worker
   アプリシェルをキャッシュしてオフラインでも起動できるようにする。
   相対パスで登録するため、Flask（ルート配信）でも GitHub Pages
   （サブパス配信）でも同じコードで動作する。 */
const CACHE = "ouchi-hub-v1";
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

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API はキャッシュせずネットワーク優先（動的データ）
  if (url.pathname.indexOf("/api/") !== -1) return;

  // 静的アセットはキャッシュ優先＋ネットワーク補完
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match("./"));   // オフライン時はトップを返す
    })
  );
});
