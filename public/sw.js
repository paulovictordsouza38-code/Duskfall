// Service worker: necessario para instalar o app. Rede primeiro; guarda copia para abrir mesmo com rede ruim.
const CACHE = 'duskfall-v6';
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icons/icon-192.png'])).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  if (r.url.includes('/health') || r.headers.has('range')) return;
  e.respondWith(
    fetch(r)
      .then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(r, c)).catch(() => {}); } return res; })
      .catch(() => caches.match(r).then((m) => m || (r.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
