/**
 * Traduce el estado del Sync Client a los indicadores visuales pedidos:
 * 🟢 Sincronizado · 🟡 N pendientes · 🔴 Error de sincronización ·
 * 📴 Sin conexión.
 */

const TEXTOS = {
  sincronizado: () => '🟢 Sincronizado',
  pendiente: (n) => `🟡 ${n} pendiente${n === 1 ? '' : 's'}`,
  error: (n) => `🔴 Error de sincronización${n ? ` (${n} pendientes)` : ''}`,
  'sin-conexion': () => '📴 Sin conexión',
  'sin-sesion': () => '⏳ Esperando inicio de sesión',
};

export function iniciarIndicadorConexion() {
  const indicador = document.getElementById('indicador-conexion');
  const aviso = document.getElementById('aviso-offline');

  function actualizar(detalle) {
    const texto = TEXTOS[detalle.estado] ? TEXTOS[detalle.estado](detalle.pendientes) : detalle.estado;
    if (indicador) indicador.textContent = texto;

    if (aviso) {
      if (detalle.estado === 'sin-conexion') {
        aviso.hidden = false;
        aviso.textContent =
          '📴 Sin conexión — los datos se guardarán en el dispositivo y se sincronizarán automáticamente cuando vuelva Internet.';
      } else if (detalle.estado === 'error') {
        aviso.hidden = false;
        aviso.textContent = detalle.motivo
          ? `🔴 No se pudo sincronizar: ${detalle.motivo}. Se seguirá intentando automáticamente; tus datos están guardados en el dispositivo.`
          : '🔴 Hubo un problema al sincronizar. Se seguirá intentando automáticamente; tus datos están guardados en el dispositivo.';
      } else {
        aviso.hidden = true;
      }
    }
  }

  document.addEventListener('bananera:estado-sync', (evento) => actualizar(evento.detail));

  // Estado inicial optimista antes de que corra el primer ciclo de sync.
  actualizar({ estado: navigator.onLine ? 'pendiente' : 'sin-conexion', pendientes: 0 });
}
