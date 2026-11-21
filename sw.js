/**
 * HORA — Progressive Web App Service Worker
 * - Precaches the minimalist app shell for instant launches & offline support.
 * - Uses Network-First for same-origin shell files so deploys update seamlessly.
 * - Keeps the 2 most recent artwork images cached so the current hourly piece
 *   still renders cleanly if reopened offline.
 */

const SHELL_CACHE = 'hora-shell-v1';
const ARTWORK_CACHE = 'hora-artwork-v1';
const MAX_CACHED_ARTWORKS = 2;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/api.js',
  './js/classify.js',
  './js/clock.js',
  './js/config.js',
  './js/storage.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const validCaches = new Set([SHELL_CACHE, ARTWORK_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !validCaches.has(key)).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

async function trimArtworkCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_CACHED_ARTWORKS) return;
  const excess = keys.slice(0, keys.length - MAX_CACHED_ARTWORKS);
  await Promise.all(excess.map((req) => cache.delete(req)));
}

function isArtworkImageRequest(request, url) {
  if (request.destination !== 'image') return false;
  return (
    url.hostname.endsWith('artic.edu') ||
    url.hostname.endsWith('metmuseum.org')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1. Same-origin app shell & navigation: Network-First with cache fallback.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          throw new Error('Offline and resource not cached');
        })
    );
    return;
  }

  // 2. Museum artwork images: Network-First, retaining the latest 2 for offline viewing.
  if (isArtworkImageRequest(request, url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cross-origin <img> requests may be opaque (status 0) or CORS 200; both are cacheable.
          if (response && (response.ok || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(ARTWORK_CACHE).then(async (cache) => {
              await cache.put(request, copy);
              await trimArtworkCache(cache);
            });
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          throw new Error('Offline and artwork image not cached');
        })
    );
  }
});
