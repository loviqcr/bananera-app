/**
 * Capa de escritura genérica para TODOS los módulos de datos (producción,
 * labores, inventario, bodegas, incidencias, planilla, ventas, embolse,
 * corta...). Cada módulo llama crear()/editar()/eliminar() con el nombre de
 * su almacén de IndexedDB (que debe coincidir con el nombre de la tabla en
 * el backend — así el registro de sincronización del servidor los conecta
 * automáticamente) y sus campos de negocio.
 *
 * La lectura no se generaliza aquí a propósito: cada módulo sabe mejor por
 * qué índice quiere consultar (por finca, por área, por empleado...), así
 * que usa directamente localdb.getPorIndice()/getAll() — ver los módulos en
 * frontend/js/modules/ como ejemplo.
 */
import { localdb, generarUUID } from './localdb.js';
import { auth } from '../modules/auth.js';

export const repos = {
  /**
   * Crea un registro nuevo: genera el UUID, lo guarda de inmediato en
   * IndexedDB (aparece en la UI al instante) y encola su sincronización.
   * Funciona igual con o sin conexión.
   */
  async crear(tabla, datosNegocio) {
    const sesion = await auth.sesionActual();
    const id = generarUUID();
    const registro = {
      id,
      ...datosNegocio,
      creado_por: sesion?.usuario?.id ?? null,
      updated_at: new Date().toISOString(),
      eliminado_at: null,
    };
    await localdb.put(tabla, registro);
    await localdb.encolarOperacion({ tabla, operacion: 'crear', id, datos: datosNegocio });
    return registro;
  },

  /**
   * Edita un registro existente. `cambios` puede traer solo los campos que
   * cambiaron — el backend actualiza únicamente esos, sin tocar el resto.
   */
  async editar(tabla, id, cambios) {
    const actual = (await localdb.get(tabla, id)) ?? { id };
    const registro = { ...actual, ...cambios, updated_at: new Date().toISOString() };
    await localdb.put(tabla, registro);
    await localdb.encolarOperacion({ tabla, operacion: 'editar', id, datos: cambios });
    return registro;
  },

  /** Borrado lógico: desaparece de las listas locales de inmediato. */
  async eliminar(tabla, id) {
    const actual = await localdb.get(tabla, id);
    if (actual) {
      actual.eliminado_at = new Date().toISOString();
      await localdb.put(tabla, actual);
    }
    await localdb.encolarOperacion({ tabla, operacion: 'eliminar', id });
  },

  /** Lista todo lo no-eliminado de un almacén (para tablas sin finca_id). */
  async listarTodos(tabla) {
    const filas = await localdb.getAll(tabla);
    return filas.filter((f) => !f.eliminado_at);
  },

  /** Lista lo no-eliminado de un almacén filtrado por finca_id. */
  async listarPorFinca(tabla, fincaId) {
    if (!fincaId || fincaId === 'todas') {
      const filas = await localdb.getAll(tabla);
      return filas.filter((f) => !f.eliminado_at);
    }
    const filas = await localdb.getPorIndice(tabla, 'finca_id', fincaId);
    return filas.filter((f) => !f.eliminado_at);
  },
};
