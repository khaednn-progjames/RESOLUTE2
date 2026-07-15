// =============================================================
// Minimal service worker — just enough to make the dashboard
// installable as an app, with light offline resilience.
//
// Strategy: network-first, cache-fallback. This is a fast-moving
// personal project, so we never want to serve stale JS/HTML while
// online — the cache only kicks in when the network request fails
// (truly offline), so you get *something* instead of a hard error.
// =============================================================
const CACHE_NAME = 'dashboard-shell-v1';
const SHELL_ASSETS = [
  '/index.html',
  '/topbar.js',
  '/sync.js',
  '/sirius-usage.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => {}) // don't block install if one asset 404s during dev
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (Supabase, Anthropic, CDNs) pass through untouched

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
