/**
 * Cachea el "shell" de la app (HTML/CSS/JS/íconos) para que abra sin
 * conexión. Las llamadas a la API (fetch hacia el backend) NUNCA pasan por
 * este caché — esas las maneja directamente el Sync Client contra
 * IndexedDB, que es la fuente de verdad local.
 */
const CACHE = 'bananera-shell-v1';

const ARCHIVOS_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/estilos.css',
  './js/app.js',
  './js/config.js',
  './js/db/localdb.js',
  './js/sync/syncClient.js',
  './js/modules/auth.js',
  './js/modules/fincas.js',
  './js/modules/estadoConexion.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);

  // Solo se cachea el propio origen (el shell). Las llamadas al backend
  // (otro origen) se dejan pasar directo a la red sin interceptar.
  if (url.origin !== self.location.origin) return;
  if (evento.request.method !== 'GET') return;

  evento.respondWith(
    caches.match(evento.request).then((cacheada) => {
      const redFetch = fetch(evento.request)
        .then((respuestaRed) => {
          caches.open(CACHE).then((cache) => cache.put(evento.request, respuestaRed.clone()));
          return respuestaRed;
        })
        .catch(() => cacheada);
      return cacheada || redFetch;
    })
  );
});
