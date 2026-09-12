import { API_BASE_URL } from '../config.js';
import { localdb, generarUUID } from '../db/localdb.js';
import { auth } from './auth.js';

const CLAVE_FINCA = 'bananera:finca_activa';
const CLAVE_AREA = 'bananera:area_activa';

export const fincas = {
  /**
   * Devuelve las 4 fincas. Si hay conexión, refresca desde el backend y
   * actualiza la caché local; si no, sirve directo desde IndexedDB — así
   * el selector de finca siempre funciona, con o sin internet.
   */
  async listar() {
    if (navigator.onLine) {
      try {
        const token = await auth.obtenerToken();
        const respuesta = await fetch(`${API_BASE_URL}/fincas`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (respuesta.ok) {
          const datos = await respuesta.json();
          await localdb.putMuchos('fincas', datos);
          return datos;
        }
      } catch {
        // sigue abajo y sirve la caché local
      }
    }
    const cache = await localdb.getAll('fincas');
    return cache.sort((a, b) => a.orden - b.orden);
  },

  /**
   * Renombra una finca (solo administrador; el backend lo valida igual).
   * Requiere conexión — a diferencia de crearArea(), no se encola porque
   * fincas no pasa por el motor de sync genérico (son solo 4 filas fijas).
   */
  async renombrar(fincaId, nombre) {
    const token = await auth.obtenerToken();
    const respuesta = await fetch(`${API_BASE_URL}/fincas/${fincaId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nombre }),
    });
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo renombrar la finca');
    await localdb.put('fincas', cuerpo);
    return cuerpo;
  },

  async listarAreas(fincaId) {
    if (navigator.onLine) {
      try {
        const token = await auth.obtenerToken();
        const respuesta = await fetch(`${API_BASE_URL}/fincas/${fincaId}/areas`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (respuesta.ok) {
          const datos = await respuesta.json();
          await localdb.putMuchos('areas', datos);
          return datos;
        }
      } catch {
        // sigue abajo y sirve la caché local
      }
    }
    const cache = await localdb.getPorIndice('areas', 'finca_id', fincaId);
    return cache.filter((a) => !a.eliminado_at).sort((a, b) => a.orden - b.orden);
  },

  /**
   * Crea un área nueva guardando primero en IndexedDB y encolando la
   * sincronización — funciona igual con o sin internet.
   */
  async crearArea(fincaId, nombre) {
    const usuario = (await auth.sesionActual())?.usuario;
    const registro = {
      id: generarUUID(),
      finca_id: fincaId,
      nombre,
      orden: 99,
      creado_por: usuario?.id ?? null,
      updated_at: new Date().toISOString(),
      eliminado_at: null,
    };
    await localdb.put('areas', registro);
    await localdb.encolarOperacion({
      tabla: 'areas',
      operacion: 'crear',
      id: registro.id,
      datos: { finca_id: fincaId, nombre, orden: registro.orden },
    });
    return registro;
  },

  guardarFincaActiva(fincaId) {
    localStorage.setItem(CLAVE_FINCA, fincaId);
    localStorage.removeItem(CLAVE_AREA);
  },

  guardarAreaActiva(areaId) {
    localStorage.setItem(CLAVE_AREA, areaId);
  },

  obtenerFincaActiva() {
    return localStorage.getItem(CLAVE_FINCA);
  },

  obtenerAreaActiva() {
    return localStorage.getItem(CLAVE_AREA);
  },

  limpiarSeleccion() {
    localStorage.removeItem(CLAVE_FINCA);
    localStorage.removeItem(CLAVE_AREA);
  },
};
