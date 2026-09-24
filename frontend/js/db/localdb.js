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
const VERSION_DB = 6;

// Cada almacén sincronizable, con su índice por finca_id cuando aplica (para
// poder filtrar por finca activa sin conexión). Un almacén nuevo aquí queda
// disponible de inmediato para repos.js — no hace falta tocar nada más en
// esta capa.
const ALMACENES = {
  // núcleo (Fase 1)
  fincas: { keyPath: 'id', indices: [] },
  areas: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },
  sesion: { keyPath: 'clave', indices: [] },
  meta: { keyPath: 'clave', indices: [] },
  sync_queue: { keyPath: 'clave', autoIncrement: true, indices: [{ nombre: 'tabla', ruta: 'tabla' }] },
  // El servidor rechazó estas (dato inválido/duplicado, no error de red) —
  // a diferencia de sync_queue, NO se reintentan solas. Quedan acá para que
  // el usuario se entere de inmediato (antes esto solo quedaba en un
  // console.warn invisible) y para que Reportes > Sincronización pueda
  // mostrar un historial. Ver syncClient.js.
  sync_rechazos: { keyPath: 'clave', autoIncrement: true, indices: [] },

  // Fase 2: producción
  variedades: { keyPath: 'id', indices: [] },
  entregas_platano: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },
  entregas_banano: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },

  // Fase 3: labores y calendario
  configuracion_frecuencias: { keyPath: 'id', indices: [] },
  labores_siembra: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },
  labores_deshija: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },
  labores_dermaticida: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },
  labores_fertilizacion: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },

  // Fase 4: inventario, equipos y bodegas
  insumos: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },
  movimientos_insumo: { keyPath: 'id', indices: [{ nombre: 'insumo_id', ruta: 'insumo_id' }] },
  equipos: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },
  bodegas: { keyPath: 'id', indices: [] },
  bodega_items: { keyPath: 'id', indices: [{ nombre: 'bodega_id', ruta: 'bodega_id' }] },
  movimientos_bodega: { keyPath: 'id', indices: [{ nombre: 'bodega_item_id', ruta: 'bodega_item_id' }] },

  // Fase 5: incidencias
  incidencias: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },

  // Fase 6: planilla
  empleados: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },
  asistencia: { keyPath: 'id', indices: [{ nombre: 'empleado_id', ruta: 'empleado_id' }] },
  // Aparte de empleados a propósito — el backend solo la sincroniza a
  // administrador/planilla (ver syncRegistry.ts), así que en cualquier
  // otro rol este almacén simplemente queda vacío en el dispositivo.
  salarios: { keyPath: 'id', indices: [{ nombre: 'empleado_id', ruta: 'empleado_id' }] },

  // Fase 7: ventas
  clientes: { keyPath: 'id', indices: [] },
  ventas_platano: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },
  ventas_banano: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },

  // Fase 8: embolse y corta
  colores_cinta: { keyPath: 'id', indices: [] },
  embolse: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },
  corta: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },

  // Entrega de Carga: catálogo de nombres fijos de responsables (no son
  // usuarios del sistema). Las entregas en sí se guardan en
  // entregas_platano (ver migración 007_entrega_carga.sql).
  responsables_carga: { keyPath: 'id', indices: [] },

  // Pedidos a bodega: texto libre de lo que necesita una finca (migración
  // 009_pedidos_bodega.sql).
  pedidos_bodega: { keyPath: 'id', indices: [{ nombre: 'finca_id', ruta: 'finca_id' }] },
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

  /**
   * Registra un rechazo del servidor (dato inválido/duplicado — no un
   * problema de red) para que quede visible, tanto en el momento (toast en
   * app.js) como después en Reportes > Sincronización. Se guardan como
   * máximo los últimos 30 para no acumular basura indefinidamente.
   */
  async registrarRechazo({ tabla, operacion, id, motivo }) {
    const item = { tabla, operacion, id, motivo: motivo || 'Sin detalle', fecha: new Date().toISOString() };
    await ejecutarTransaccion('sync_rechazos', 'readwrite', (store) => store.add(item));
    const todos = await this.getAll('sync_rechazos');
    if (todos.length > 30) {
      const sobrantes = todos.sort((a, b) => a.clave - b.clave).slice(0, todos.length - 30);
      await ejecutarTransaccion('sync_rechazos', 'readwrite', (store) => {
        for (const sobrante of sobrantes) store.delete(sobrante.clave);
      });
    }
    document.dispatchEvent(new CustomEvent('bananera:operacion-rechazada', { detail: item }));
    return item;
  },

  async obtenerRechazos() {
    const todos = await this.getAll('sync_rechazos');
    return todos.sort((a, b) => b.clave - a.clave);
  },

  async limpiarRechazos() {
    return this.vaciar('sync_rechazos');
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
