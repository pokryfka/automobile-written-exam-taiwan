// Offline support: serve same-origin files from cache, refresh them in the background.
const CACHE = 'car-exam-v12';
// English and Chinese text are always used; another second language is cached by the fetch
// handler when the app first loads it.
const SHELL = ['./', 'index.html', 'styles.css', 'core.js', 'app.js', 'manifest.webmanifest', 'data/bank.json', 'data/text/en.json', 'data/text/zh-Hant.json',
  'i18n/en.json', 'i18n/zh-Hant.json', 'version.json'];

// Pre-cache the app and every question picture so practice works fully offline.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL);
    const { questions } = await (await c.match('data/bank.json')).json();
    const pics = new Set(questions.flatMap(q => (q.images || []).concat(q.optionImages || [])).map(p => 'data/' + p));
    await c.addAll([...pics]);
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // The sync API must always hit the network.
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(res => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
