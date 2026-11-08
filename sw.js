/* Service worker: เก็บไฟล์ของแอปไว้ในเครื่องเพื่อเปิดเร็วและเปิดได้แม้เน็ตไม่ดี
 * - ไม่ cache ข้อมูลจาก API (Apps Script อยู่คนละโดเมน จึงไม่ผ่าน worker นี้)
 * - ขอไฟล์จาก server ใหม่ทุกครั้งเมื่อออนไลน์ (ข้าม HTTP cache 10 นาทีของ GitHub Pages)
 * - เมื่อแก้ไฟล์ใดๆ ให้เพิ่มเลข VERSION (และ APP_VERSION ใน js/app.js ให้ตรงกัน) */
const VERSION = 'fo602-v1.4.4';
const SHELL = [
  './', 'index.html', 'css/app.css', 'js/config.js', 'js/api.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
];
self.addEventListener('install', e => {
  // cache ทีละไฟล์ — ไฟล์ใดหายไม่ทำให้การติดตั้งทั้งหมดล้ม
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.allSettled(SHELL.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => r.ok && c.put(u, r)))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network-first + no-cache: ได้ไฟล์ล่าสุดเสมอเมื่อออนไลน์ / ใช้ไฟล์ใน cache เมื่อออฟไลน์
  e.respondWith(
    fetch(new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
