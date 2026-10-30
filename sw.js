// =========================================
// Corner Todo 서비스 워커 (11단계)
// - 앱 파일을 폰·PC 안에 보관해 두어, 인터넷이 끊겨도 앱 화면이 열리게 함
// - 앱 파일은 "인터넷 먼저, 안 되면 보관본" → 고친 내용이 바로 반영됨
// - Firebase 도구(버전이 고정된 파일)는 "보관본 먼저"
// - 할 일 데이터는 여기서 다루지 않음 (Firestore가 따로 관리)
// =========================================
const CACHE = 'corner-todo-v1';
const SHELL = [
  './', './index.html', './style.css', './app.js', './firebase-config.js',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 우리 앱 파일: 인터넷 먼저
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Firebase 도구 파일: 보관본 먼저
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
  }
  // 그 밖의 요청(로그인, Firestore)은 손대지 않음
});
