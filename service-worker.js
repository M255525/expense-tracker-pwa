// Cache-first app shell. Bump CACHE_NAME on every deploy that changes
// any cached file — a stale version number is the single most common
// bug class for this style of app in this workspace (see
// ai-course-hub's ?v= cache-busting note).
const CACHE_NAME = 'expense-tracker-v13';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/db.js',
  './js/invoice-parser.js',
  './js/scanner.js',
  './js/charts.js',
  './js/backup.js',
  './js/app.js',
  './lib/jsqr.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(
      // cache.addAll()/plain fetch() honor the browser's normal HTTP cache
      // heuristics — on a returning device that already has an old
      // js/app.js etc. HTTP-cached, addAll can silently re-cache that
      // stale copy into the NEW CACHE_NAME, defeating the whole point of
      // bumping the version. {cache:'reload'} forces a real network fetch.
      SHELL_FILES.map((file) => fetch(file, { cache: 'reload' }).then((res) => cache.put(file, res)))
    )).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // No cross-origin calls in this app (backup/restore is local-file-only,
  // not a network call) — this exclusion is just defensive in case that
  // ever changes, so a future network call wouldn't get stuck on cache.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => cached);
    })
  );
});
