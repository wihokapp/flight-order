/* Service worker: เก็บไฟล์ของแอปไว้ในเครื่องเพื่อเปิดเร็วและเปิดได้แม้เน็ตไม่ดี
 * ไม่ cache ข้อมูลจาก API (Apps Script อยู่คนละโดเมน จึงไม่ผ่าน worker นี้)
 * เมื่อแก้ไฟล์ใดๆ ให้เพิ่มเลข VERSION เพื่อให้ผู้ใช้ได้ไฟล์ใหม่ */
const VERSION = 'fo602-v1.3.0';
const SHELL = [
  './', 'index.html', 'css/app.css', 'js/config.js', 'js/api.js', 'js/app.js',
  'js/demo/gas-emulator.js', 'js/demo/demo-backend.js', 'backend/Code.gs',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network-first: ได้ไฟล์ล่าสุดเมื่อออนไลน์ / ใช้ไฟล์ใน cache เมื่อออฟไลน์
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
