/* Ram Gear offline service worker. The cache name comes from js/version.js (single source of truth):
   bump APP_BUILD (and APP_REV for a release) there whenever any app file changes. */
importScripts('js/version.js');
const VERSION = `rg-rev${self.APP_REV}-${self.APP_BUILD}`;
const ASSETS = [
  './', 'index.html', 'app.css', 'forms.json', 'manifest.webmanifest',
  'js/version.js', 'js/db.js', 'js/admin.js', 'js/auth.js', 'js/photos.js', 'js/camera.js', 'js/pdf.js', 'js/app.js', 'vendor/pdf-lib.min.js', 'vendor/fflate.min.js',
  'templates/gearbox-assembly-checklist.pdf', 'templates/gearbox-teardown-analysis.pdf',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-64.png',
  'img/login-bg.jpg', 'img/ramgear-logo.jpg'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS.map(a => new Request(a, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, {ignoreSearch: true}).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => req.mode === 'navigate' ? caches.match('index.html') : Response.error()))
  );
});
