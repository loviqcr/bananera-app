import { API_BASE_URL, INTERVALO_SYNC_MS } from '../config.js';
import { localdb } from '../db/localdb.js';
import { auth } from '../modules/auth.js';

const CLAVE_MARCA = 'ultima_sincronizacion';
const TAMANO_LOTE = 50;

let sincronizando = false;
let temporizador = null;

function emitirEstado(estado, extra = {}) {
  document.dispatchEvent(new CustomEvent('bananera:estado-sync', { detail: { estado, ...extra } }));
}

async function empujarCambios(token) {
  const cola = await localdb.obtenerCola();
  if (cola.length === 0) return { huboErrores: false };

  const lote = cola.slice(0, TAMANO_LOTE);
  const operaciones = lote.map((item) => ({
    tabla: item.tabla,
    operacion: item.operacion,
    id: item.id,
    datos: item.datos ?? undefined,
    actualizadoEn: item.actualizadoEn,
    dispositivoId: item.dispositivoId,
  }));

  let respuesta;
  try {
    respuesta = await fetch(`${API_BASE_URL}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ operaciones }),
    });
  } catch (error) {
    // Sin red a mitad de la sincronización: la cola queda intacta, se
    // reintenta en el próximo ciclo sin duplicar nada (mismo UUID).
    return { huboErrores: true, motivo: 'Sin conexión durante el envío' };
  }

  if (!respuesta.ok) {
    return { huboErrores: true, motivo: `El servidor respondió ${respuesta.status}` };
  }

  const cuerpo = await respuesta.json();
  let huboErrores = false;

  for (let i = 0; i < lote.length; i++) {
    const item = lote[i];
    const resultado = cuerpo.resultados[i];
    if (!resultado) continue;

    if (resultado.estado === 'ok') {
      await localdb.quitarDeCola(item.clave);
    } else if (resultado.estado === 'rechazado') {
      // No es un problema de red: el servidor decidió no aplicarlo
      // (permiso, validación, o una versión más reciente ya existente por
      // last-write-wins). Reintentarlo no lo va a resolver, así que se saca
      // de la cola y se deja constancia en consola para depuración.
      console.warn(`[sync] Operación rechazada (${item.tabla}/${item.id}): ${resultado.motivo}`);
      await localdb.quitarDeCola(item.clave);
    } else {
      huboErrores = true;
      await localdb.marcarIntentoFallido(item.clave, resultado.motivo || 'Error desconocido');
    }
  }

  return { huboErrores };
}

async function halarCambios(token) {
  const marca = await localdb.get('meta', CLAVE_MARCA);
  const desde = marca ? `?desde=${encodeURIComponent(marca.valor)}` : '';

  let respuesta;
  try {
    respuesta = await fetch(`${API_BASE_URL}/sync/pull${desde}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { huboErrores: true };
  }
  if (!respuesta.ok) return { huboErrores: true };

  const cuerpo = await respuesta.json();
  for (const [tabla, registros] of Object.entries(cuerpo.cambios)) {
    if (registros.length === 0) continue;
    await localdb.putMuchos(tabla, registros);
  }
  await localdb.put('meta', { clave: CLAVE_MARCA, valor: cuerpo.marca });
  return { huboErrores: false };
}

export async function sincronizarAhora() {
  if (sincronizando) return;
  const pendientesAntes = await localdb.contarPendientes();

  if (!navigator.onLine) {
    emitirEstado('sin-conexion', { pendientes: pendientesAntes });
    return;
  }

  const token = await auth.obtenerToken();
  if (!token) {
    emitirEstado('sin-sesion', { pendientes: pendientesAntes });
    return;
  }

  sincronizando = true;
  try {
    const resultadoPush = await empujarCambios(token);
    const resultadoPull = await halarCambios(token);

    const pendientesDespues = await localdb.contarPendientes();

    if (resultadoPush.huboErrores || resultadoPull.huboErrores) {
      emitirEstado('error', { pendientes: pendientesDespues });
    } else if (pendientesDespues > 0) {
      emitirEstado('pendiente', { pendientes: pendientesDespues });
    } else {
      emitirEstado('sincronizado', { pendientes: 0 });
    }
  } finally {
    sincronizando = false;
  }
}

export function iniciarSyncClient() {
  window.addEventListener('online', () => sincronizarAhora());
  window.addEventListener('offline', () => sincronizarAhora());
  document.addEventListener('bananera:cola-cambio', async () => {
    // Actualización optimista inmediata del indicador (no espera red) para
    // que el usuario vea al instante que su registro quedó guardado y
    // pendiente de subir.
    const pendientes = await localdb.contarPendientes();
    if (navigator.onLine) {
      emitirEstado('pendiente', { pendientes });
      sincronizarAhora();
    } else {
      emitirEstado('sin-conexion', { pendientes });
    }
  });

  if (temporizador) clearInterval(temporizador);
  temporizador = setInterval(() => sincronizarAhora(), INTERVALO_SYNC_MS);

  sincronizarAhora();
}
