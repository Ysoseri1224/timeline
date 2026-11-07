/* Service worker for /timeline/. Generated into dist/sw.js by scripts/build-sw.mjs. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL_PREFIX = 'timeline-shell-';
const SHELL = SHELL_PREFIX + VERSION;
const MEDIA = 'timeline-media-v1';
const FONTS = 'timeline-fonts-v1';
const BASE = '/timeline/';
const SHELL_MARKER = 'name="timeline-shell"';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    for (const url of PRECACHE) {
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) throw new Error(`precache ${url}: ${response.status}`);
      await cache.put(url, await unredirect(response));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // keep the previous shell too, so a page still running the old version can load its files
    const shells = (await caches.keys()).filter((k) => k.startsWith(SHELL_PREFIX) && k !== SHELL).sort();
    for (const old of shells.slice(0, -1)) await caches.delete(old);
    await self.clients.claim();
  })());
});

// Safari refuses redirected responses for navigations served by a service worker.
async function unredirect(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (!url.pathname.startsWith(BASE)) return;
    if (url.pathname.startsWith(BASE + '__local/')) return event.respondWith(localImage(url.pathname.slice((BASE + '__local/').length)));
    if (url.pathname.startsWith(BASE + 'api/media/')) {
      if (request.headers.has('range')) return; // video: always from the network
      return event.respondWith(cacheFirst(MEDIA, request, (r) => /^image\//.test(r.headers.get('content-type') || '')));
    }
    if (url.pathname.startsWith(BASE + 'api/')) return; // API: network only, the page keeps its own copy
    if (request.mode === 'navigate') return event.respondWith(shell(event));
    return event.respondWith(cacheFirst(SHELL, request, (r) => r.ok));
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(FONTS, request, (r) => r.ok || r.type === 'opaque'));
  }
});

async function cacheFirst(cacheName, request, cacheable) {
  const hit = await caches.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (cacheable(response)) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

// App shell: always answer from cache (works offline and behind Wi-Fi login pages),
// refresh it in the background when the network gives back the real page.
async function shell(event) {
  const cache = await caches.open(SHELL);
  const cached = (await cache.match(BASE)) || (await caches.match(BASE));
  const refresh = (async () => {
    try {
      const response = await fetch(BASE, { cache: 'no-store' });
      const text = response.ok ? await response.clone().text() : '';
      if (text.includes(SHELL_MARKER)) await cache.put(BASE, await unredirect(response.clone()));
      return response;
    } catch {
      return null;
    }
  })();
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || new Response('离线，且本机还没有缓存过这个页面。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('timeline-offline', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('ops')) db.createObjectStore('ops', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function localImage(id) {
  try {
    const db = await openDb();
    const record = await new Promise((resolve, reject) => {
      const req = db.transaction('blobs').objectStore('blobs').get('local:' + decodeURIComponent(id));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (record) return new Response(record.blob, { headers: { 'Content-Type': record.type || 'image/jpeg', 'Cache-Control': 'no-store' } });
    // already uploaded and cleaned up: the cached copy of the real file
    return new Response('', { status: 404 });
  } catch {
    return new Response('', { status: 500 });
  }
}
