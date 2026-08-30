/**
 * URL base del backend. Cambiar esto al publicar (por ejemplo la URL de
 * Render/Railway/Fly.io donde quede desplegado el backend de
 * /backend). En desarrollo local apunta al puerto por defecto del backend.
 */
export const API_BASE_URL = window.BANANERA_API_URL || 'http://localhost:3000';

// Cada cuántos milisegundos se intenta sincronizar en segundo plano
// mientras hay conexión (además de sincronizar de inmediato al reconectar).
export const INTERVALO_SYNC_MS = 30000;
