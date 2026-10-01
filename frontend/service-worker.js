/**
 * Cachea el "shell" de la app (HTML/CSS/JS/íconos) para que abra sin
 * conexión. Las llamadas a la API (fetch hacia el backend) NUNCA pasan por
 * este caché — esas las maneja directamente el Sync Client contra
 * IndexedDB, que es la fuente de verdad local.
 */
const CACHE = 'bananera-shell-v89';

const ARCHIVOS_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/estilos.css',
  './fonts/anton-latin-400.woff2',
  './fonts/work-sans-latin-400.woff2',
  './fonts/work-sans-latin-500.woff2',
  './fonts/work-sans-latin-600.woff2',
  './fonts/work-sans-latin-700.woff2',
  './js/app.js',
  './js/config.js',
  './js/ui.js',
  './js/db/localdb.js',
  './js/db/repos.js',
  './js/sync/syncClient.js',
  './js/modules/auth.js',
  './js/modules/fincas.js',
  './js/modules/estadoConexion.js',
  './js/modules/produccion.js',
  './js/modules/labores.js',
  './js/modules/calendario.js',
  './js/modules/inventario.js',
  './js/modules/incidencias.js',
  './js/modules/alertas.js',
  './js/modules/planilla.js',
  './js/modules/ventas.js',
  './js/modules/embolseCorta.js',
  './js/modules/dashboard.js',
  './js/modules/reportes.js',
  './js/modules/usuarios.js',
  './js/modules/entregaCarga.js',
  './js/modules/pedidosBodega.js',
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

/**
 * Notificaciones push reales (Web Push): el navegador/SO entrega este
 * evento al service worker aunque la app esté cerrada del todo — por eso
 * SIEMPRE se muestra la notificación del sistema acá (satisface "cuando
 * está instalada, que avise en pantalla"). Además, si hay alguna pestaña/PWA
 * de la app abierta en ese momento, se le manda un mensaje para que muestre
 * también un aviso dentro de la propia app (el popup que se ve navegando).
 */
self.addEventListener('push', (evento) => {
  let datos = {};
  try {
    datos = evento.data ? evento.data.json() : {};
  } catch {
    datos = { titulo: 'Cosechas Presbere', mensaje: evento.data ? evento.data.text() : '' };
  }

  const titulo = datos.titulo || 'Cosechas Presbere';
  const opciones = {
    body: datos.mensaje || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    vibrate: [120, 60, 120],
    // modulo/tab: a dónde lleva la notificación al tocarla (ver notificationclick).
    data: { url: datos.url || './', modulo: datos.modulo || null, tab: datos.tab || null },
  };

  evento.waitUntil(
    Promise.all([
      self.registration.showNotification(titulo, opciones),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
        for (const cliente of lista) cliente.postMessage({ tipo: 'bananera:push', payload: datos });
      }),
    ])
  );
});

/**
 * Al tocar la notificación se abre el módulo que avisó (ej. Pedidos a
 * bodega, o la pestaña Corta):
 *  - si la app ya está abierta, se le manda un mensaje para que cambie de
 *    módulo y se le da el foco;
 *  - si está cerrada, se abre con ?modulo=...&tab=... y la app lo lee al
 *    arrancar (ver app.js).
 * Una notificación sin módulo (avisos viejos) solo abre la app como antes.
 */
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const { url = './', modulo = null, tab = null } = evento.notification.data || {};
  const destino = modulo ? `./?modulo=${encodeURIComponent(modulo)}${tab ? `&tab=${encodeURIComponent(tab)}` : ''}` : url;
  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (lista) => {
      for (const cliente of lista) {
        if ('focus' in cliente) {
          if (modulo) cliente.postMessage({ tipo: 'bananera:abrir-modulo', modulo, tab });
          return cliente.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(destino);
    })
  );
});
