/* v3.298 [WebPush] MAIDOL 서비스 워커 — 푸시 표시·탭 시 앱 열기. 캐시·오프라인 처리는 하지 않는다(배포 갱신 영향 없음). */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  var title = data.title || 'MAIDOL';
  var options = {
    body: data.body || '새 알림이 있어요',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.tag || 'maidol',
    renotify: true,
    data: { url: data.url || '/app' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/app';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url && c.url.indexOf(self.location.origin) === 0 && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
