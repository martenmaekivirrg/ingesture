// Ingesture service worker: offline app shell + Android share target.
// Docs: MDN share_target ("Receiving share data using POST"), checked 2026-11-24 via Context7.

const CACHE = 'ingesture-v1';
const SHELL = [
  './', './index.html', './app.css', './app.js', './manifest.webmanifest',
  './lib/capture.mjs', './lib/github.mjs', './lib/queue.mjs', './lib/image.mjs', './lib/sender.mjs',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function saveShared(record) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ingesture', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('shared')) db.createObjectStore('shared', { keyPath: 'id' });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('shared', 'readwrite');
      tx.objectStore('shared').put({ id: 'latest', ...record });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Android share sheet → POST ./share (multipart). Store it, then open the app prefilled.
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share')) {
    event.respondWith((async () => {
      const form = await event.request.formData();
      const image = form.get('image');
      await saveShared({
        title: String(form.get('title') || ''),
        text: String(form.get('text') || ''),
        url: String(form.get('url') || ''),
        image: image && typeof image === 'object' && image.size ? image : null,
      });
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }

  // Never cache GitHub API calls or anything that isn't a GET.
  if (event.request.method !== 'GET' || url.hostname === 'api.github.com') return;

  // The app's own files: network first, so a new version arrives as soon as it is
  // published; the cache is only the offline fallback. No version bump needed.
  if (url.origin === self.location.origin) {
    const isPage = event.request.mode === 'navigate';
    const key = isPage ? './index.html' : event.request;
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(key, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(key)) || Response.error()),
    );
    return;
  }

  // Google Fonts never change: cache first.
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
      }
      return res;
    })),
  );
});
