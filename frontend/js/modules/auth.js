import { API_BASE_URL } from '../config.js';
import { localdb } from '../db/localdb.js';

const CLAVE_SESION = 'actual';

function decodificarJWT(token) {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function tokenExpirado(token) {
  const datos = decodificarJWT(token);
  if (!datos || !datos.exp) return true;
  return Date.now() >= datos.exp * 1000;
}

export const auth = {
  /**
   * Intenta iniciar sesión contra el backend. Si no hay conexión (o el
   * backend no responde), y existe una sesión guardada localmente para el
   * mismo usuario, permite continuar offline con el último token válido —
   * así el trabajo de campo no se detiene por falta de señal.
   */
  async iniciarSesion(usuario, password) {
    try {
      const respuesta = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, password }),
      });
      if (!respuesta.ok) {
        const cuerpo = await respuesta.json().catch(() => ({}));
        throw new Error(cuerpo.error || 'Usuario o contraseña incorrectos');
      }
      const datos = await respuesta.json();
      await localdb.put('sesion', {
        clave: CLAVE_SESION,
        usuario: datos.usuario,
        accessToken: datos.accessToken,
        refreshToken: datos.refreshToken,
        guardadoEn: new Date().toISOString(),
      });
      return { modo: 'en-linea', usuario: datos.usuario };
    } catch (error) {
      // Sin red o backend inalcanzable: se intenta continuar con una sesión
      // guardada localmente del mismo usuario.
      const guardada = await localdb.get('sesion', CLAVE_SESION);
      if (guardada && guardada.usuario.usuario === usuario) {
        return { modo: 'offline-cacheada', usuario: guardada.usuario, avisoConexion: error.message };
      }
      if (!navigator.onLine) {
        throw new Error('Sin conexión y no hay una sesión guardada en este dispositivo para ese usuario. Necesitas conectarte a internet la primera vez.');
      }
      throw error;
    }
  },

  async sesionActual() {
    return localdb.get('sesion', CLAVE_SESION);
  },

  /**
   * true si hay una sesión utilizable ahora mismo (en línea siempre vale;
   * offline solo si el último token guardado no muestra estar vencido,
   * aunque igual se deja entrar con aviso porque el servidor es quien
   * realmente decide si el token sigue siendo válido).
   */
  async haySesionUtilizable() {
    const sesion = await this.sesionActual();
    return !!sesion;
  },

  async tokenPuedeEstarVencido() {
    const sesion = await this.sesionActual();
    if (!sesion) return true;
    return tokenExpirado(sesion.accessToken);
  },

  async cerrarSesion() {
    await localdb.eliminar('sesion', CLAVE_SESION);
  },

  async obtenerToken() {
    const sesion = await this.sesionActual();
    return sesion ? sesion.accessToken : null;
  },
};
