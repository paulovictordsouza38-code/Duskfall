// Service worker: instala o app e deixa jogar OFFLINE contra os bots (guarda o jogo e o Three.js no aparelho).
// Rede primeiro (sempre pega a versao nova quando ha internet); sem internet usa a copia guardada.
const CACHE = 'duskfall-v22';
const LOCAIS = ["./", "./index.html", "./manifest.webmanifest", "./img/capa.jpg", "./som_pistola.mp3", "./som_dano.mp3", "./som_fuzil.mp3", "./som_smg1.wav", "./som_smg2.wav", "./som_smg3.wav", "./som_sniper.mp3", "./som_explosao.mp3", "./som_barril.mp3", "./som_fumaca.mp3", "./js/actors.js", "./js/audio.js", "./js/bots.js", "./js/character.js", "./js/effects.js", "./js/explosives.js", "./js/geometry.js", "./js/guns.js", "./js/hudlayout.js", "./js/input.js", "./js/main.js", "./js/merge.js", "./js/net.js", "./js/online.js", "./js/pickups.js", "./js/icons.js", "./js/scenery.js", "./js/soldado.js", "./js/soldado_data.js", "./js/targets.js", "./js/textures.js", "./js/weapons3d.js", "./js/world.js", "./js/glb.js", "./js/airdrop.js", "./js/logic/airdrop.js", "./heli.glb", "./js/logic/collision.js", "./js/logic/casas.js", "./js/logic/regiao.js", "./js/logic/terrain.js", "./js/logic/combat.js", "./js/logic/scoring.js", "./js/logic/weapons.js", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];
const CDN = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
const CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(
    LOCAIS.map((u) => fetch(u, { cache: 'reload' }).then((r) => (r.ok ? c.put(u, r) : null)).catch(() => {}))
      .concat([fetch(CDN, { mode: 'cors' }).then((r) => (r.ok ? c.put(CDN, r) : null)).catch(() => {})])
  )));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin && !CDN_HOSTS.includes(u.hostname)) return;
  if (u.pathname.endsWith('/health') || r.headers.has('range')) return;
  e.respondWith(
    fetch(r)
      .then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(r, c)).catch(() => {}); } return res; })
      .catch(() => caches.match(r, { ignoreSearch: true }).then((m) => m || (r.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
