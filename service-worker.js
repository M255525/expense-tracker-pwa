// Cache-first app shell, network-only for the sync endpoint. Bump
// CACHE_NAME on every deploy that changes any cached file — a stale
// version number is the single most common bug class for this style of
// app in this workspace (see ai-course-hub's ?v= cache-busting note).
const CACHE_NAME = 'expense-tracker-v1';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/db.js',
  './js/invoice-parser.js',
  './js/scanner.js',
  './js/charts.js',
  './js/sync.js',
  './js/app.js',
  './lib/jsqr.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
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

  // Never cache cross-origin calls (the Apps Script sync endpoint) —
  // always hit the network so sync reflects live server state.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => cached);
    })
  );
});
