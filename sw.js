const V = 'atelier-v3';
const SHELL = ['./', 'index.html', 'fonts.css', 'styles.css', 'app.js', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isData = req.url.includes('/data/');
  e.respondWith(isData
    ? fetch(req).then((r) => { const c = r.clone(); caches.open(V).then((x) => x.put(req, c)); return r; }).catch(() => caches.match(req))
    : caches.match(req).then((hit) => hit || fetch(req).then((r) => { const c = r.clone(); caches.open(V).then((x) => x.put(req, c)); return r; })));
});
