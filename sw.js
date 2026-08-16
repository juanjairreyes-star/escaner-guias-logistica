// Service worker mínimo: solo habilita la instalación como app.
// No cachea respuestas del API a propósito, porque el manifiesto
// se actualiza en tiempo real y siempre queremos datos frescos.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
