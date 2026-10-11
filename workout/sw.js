// オフラインでも開けるように、アプリ本体だけキャッシュする
const CACHE = 'workout-v1';
const FILES = ['./', './index.html', './style.css', './app.js', './config.js', './manifest.webmanifest', './icon.svg', '../vendor/supabase/supabase.js'];
const URLS = new Set(FILES.map((f) => new URL(f, self.registration.scope).href));

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// ネット優先・失敗したらキャッシュ(更新がすぐ反映されるように)
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !URLS.has(e.request.url)) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request)),
  );
});
