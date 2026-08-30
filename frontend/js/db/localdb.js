/**
 * Capa genérica sobre IndexedDB. Todo módulo futuro (producción, inventario,
 * incidencias, labores, ventas, embolse, corta...) guarda sus registros con
 * las mismas funciones de aquí — put()/getAll()/get()/eliminar() más
 * encolarOperacion() — así que agregar un módulo nuevo no requiere tocar
 * esta capa, solo declarar su almacén en ALMACENES de abajo.
 *
 * Principio: TODA escritura pasa primero por aquí (nunca se espera respuesta
 * del servidor para guardar). encolarOperacion() dispara el evento
 * 'bananera:cola-cambio' para que la barra de estado se actualice al
 * instante.
 */

const NOMBRE_DB = 'bananera-app';
const VERSION_DB = 1;

// Cada almacén sincronizable, con su índice por finca_id cuando aplica.
// Fase 1 solo usa 'fincas' y 'areas'; las fases futuras agregan aquí su
// almacén (por ejemplo: entregas_platano, incidencias, ventas_platano...).
const ALMACENES = {
  fincas: { keyPath: 'id', indices: [] },
  areas: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },
  sesion: { keyPath: 'clave', indices: [] },
  meta: { keyPath: 'clave', indices: [] },
  sync_queue: { keyPath: 'clave', autoIncrement: true, indices: [{ nombre: 'tabla', ruta: 'tabla' }] },
};

let promesaDB = null;

function abrirDB() {
  if (promesaDB) return promesaDB;
  promesaDB = new Promise((resolve, reject) => {
    const solicitud = indexedDB.open(NOMBRE_DB, VERSION_DB);

    solicitud.onupgradeneeded = () => {
      const db = solicitud.result;
      for (const [nombre, config] of Object.entries(ALMACENES)) {
        if (db.objectStoreNames.contains(nombre)) continue;
        const almacen = db.createObjectStore(nombre, {
          keyPath: config.keyPath,
          autoIncrement: !!config.autoIncrement,
        });
        for (const indice of config.indices) {
          almacen.createIndex(indice.nombre, indice.ruta, { unique: false });
        }
      }
    };

    solicitud.onsuccess = () => resolve(solicitud.result);
    solicitud.onerror = () => reject(solicitud.error);
  });
  return promesaDB;
}

function ejecutarTransaccion(nombreAlmacen, modo, fn) {
  return abrirDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(nombreAlmacen, modo);
        const almacen = tx.objectStore(nombreAlmacen);
        const resultado = fn(almacen);
        tx.oncomplete = () => resolve(resultado);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

function solicitudAPromesa(solicitud) {
  return new Promise((resolve, reject) => {
    solicitud.onsuccess = () => resolve(solicitud.result);
    solicitud.onerror = () => reject(solicitud.error);
  });
}

export const localdb = {
  async put(almacen, registro) {
    return ejecutarTransaccion(almacen, 'readwrite', (store) => store.put(registro));
  },

  async putMuchos(almacen, registros) {
    return ejecutarTransaccion(almacen, 'readwrite', (store) => {
      for (const registro of registros) store.put(registro);
    });
  },

  async get(almacen, id) {
    const db = await abrirDB();
    const tx = db.transaction(almacen, 'readonly');
    return solicitudAPromesa(tx.objectStore(almacen).get(id));
  },

  async getAll(almacen) {
    const db = await abrirDB();
    const tx = db.transaction(almacen, 'readonly');
    return solicitudAPromesa(tx.objectStore(almacen).getAll());
  },

  async getPorIndice(almacen, nombreIndice, valor) {
    const db = await abrirDB();
    const tx = db.transaction(almacen, 'readonly');
    const indice = tx.objectStore(almacen).index(nombreIndice);
    return solicitudAPromesa(indice.getAll(valor));
  },

  async eliminar(almacen, id) {
    return ejecutarTransaccion(almacen, 'readwrite', (store) => store.delete(id));
  },

  async vaciar(almacen) {
    return ejecutarTransaccion(almacen, 'readwrite', (store) => store.clear());
  },

  /**
   * Encola una operación de sincronización (crear/editar/eliminar) para que
   * el Sync Client la envíe al backend cuando haya conexión. No lanza si no
   * hay red — solo escribe local.
   */
  async encolarOperacion({ tabla, operacion, id, datos }) {
    const item = {
      tabla,
      operacion,
      id,
      datos: datos ?? null,
      actualizadoEn: new Date().toISOString(),
      dispositivoId: await obtenerIdDispositivo(),
      intentos: 0,
      ultimoError: null,
      creadoEn: new Date().toISOString(),
    };
    await ejecutarTransaccion('sync_queue', 'readwrite', (store) => store.add(item));
    document.dispatchEvent(new CustomEvent('bananera:cola-cambio'));
  },

  async obtenerCola() {
    return this.getAll('sync_queue');
  },

  async contarPendientes() {
    const cola = await this.getAll('sync_queue');
    return cola.length;
  },

  async quitarDeCola(clave) {
    await this.eliminar('sync_queue', clave);
    document.dispatchEvent(new CustomEvent('bananera:cola-cambio'));
  },

  async marcarIntentoFallido(clave, motivo) {
    const item = await this.get('sync_queue', clave);
    if (!item) return;
    item.intentos += 1;
    item.ultimoError = motivo;
    await this.put('sync_queue', item);
  },
};

/**
 * Identificador estable de este dispositivo/navegador (no de la persona),
 * usado para trazabilidad en creado_por/dispositivo_id. Se genera una sola
 * vez y se guarda en localStorage.
 */
export async function obtenerIdDispositivo() {
  let id = localStorage.getItem('bananera:dispositivo_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('bananera:dispositivo_id', id);
  }
  return id;
}

export function generarUUID() {
  return crypto.randomUUID();
}
