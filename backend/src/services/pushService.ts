/**
 * Notificaciones push reales (Web Push / VAPID) — a diferencia de las
 * "alertas" que ya existía (calculadas en el propio dispositivo a partir de
 * datos ya sincronizados, ver alertas.js del frontend), esto SÍ llega aunque
 * el destinatario tenga la app cerrada del todo, porque el navegador/SO
 * entrega el push por su cuenta al service worker.
 *
 * Si VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no están configuradas (ver env.ts),
 * el envío queda deshabilitado sin romper nada más del backend — solo se
 * pierde este aviso extra, la app sigue funcionando igual.
 */
import webpush from 'web-push';
import { pool } from '../db/pool';
import { env } from '../config/env';

const habilitado = Boolean(env.vapidPublicKey && env.vapidPrivateKey);

if (habilitado) {
  webpush.setVapidDetails(env.vapidContactEmail, env.vapidPublicKey!, env.vapidPrivateKey!);
} else {
  console.warn('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no configuradas: las notificaciones push quedan deshabilitadas.');
}

export function pushHabilitado() {
  return habilitado;
}

export function clavePublicaVapid() {
  return env.vapidPublicKey;
}

interface SuscripcionEntrante {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function guardarSuscripcion(usuarioId: string, sub: SuscripcionEntrante, userAgent?: string) {
  await pool.query(
    `INSERT INTO push_subscriptions (usuario_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       usuario_id = EXCLUDED.usuario_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent`,
    [usuarioId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent ?? null]
  );
}

export async function eliminarSuscripcion(endpoint: string) {
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

async function destinatariosParaFinca(fincaId: string) {
  const { rows } = await pool.query(
    `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
     FROM push_subscriptions ps
     JOIN usuarios u ON u.id = ps.usuario_id
     JOIN roles r ON r.id = u.rol_id
     WHERE u.eliminado_at IS NULL AND u.activo = true
       AND (
         r.nombre = 'administrador'
         OR (
           r.nombre = 'encargado_finca'
           AND EXISTS (SELECT 1 FROM usuario_fincas uf WHERE uf.usuario_id = u.id AND uf.finca_id = $1)
         )
       )`,
    [fincaId]
  );
  return rows as { id: string; endpoint: string; p256dh: string; auth: string }[];
}

interface PayloadNotificacion {
  titulo: string;
  mensaje: string;
  url?: string;
  /** Módulo de la app que abre el aviso dentro de la app (ver app.js). */
  modulo?: string;
}

/** Envía a administradores + encargados de esa finca. Nunca lanza: un error de envío no debe tumbar el push de sync. */
async function notificarFinca(fincaId: string, payload: PayloadNotificacion) {
  if (!habilitado) return;
  await enviarAVarios(await destinatariosParaFinca(fincaId), payload);
}

async function enviarAVarios(destinatarios: { id: string; endpoint: string; p256dh: string; auth: string }[], payload: PayloadNotificacion) {
  if (!habilitado) return;
  const cuerpo = JSON.stringify(payload);

  await Promise.all(
    destinatarios.map(async (d) => {
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, cuerpo);
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // El navegador/SO invalidó esta suscripción (desinstaló la app,
          // borró datos, etc.) — se limpia para no reintentar en vano.
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [d.id]).catch(() => {});
        } else {
          console.error('[push] Error enviando notificación:', err instanceof Error ? err.message : err);
        }
      }
    })
  );
}

/**
 * Aviso de un pedido nuevo a bodega: le llega a los administradores y al rol
 * bodega (que son quienes lo atienden), sin importar de qué finca sea, y
 * nunca a quien lo escribió (no tiene sentido avisarle de su propio pedido).
 */
export async function notificarPedidoBodega(fincaId: string, texto: string, solicitanteId: string | null) {
  if (!habilitado) return;
  try {
    const { rows: fincaRows } = await pool.query('SELECT nombre FROM fincas WHERE id = $1', [fincaId]);
    const nombreFinca = fincaRows[0]?.nombre ?? 'una finca';
    const { rows } = await pool.query(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN usuarios u ON u.id = ps.usuario_id
       JOIN roles r ON r.id = u.rol_id
       WHERE u.eliminado_at IS NULL AND u.activo = true
         AND r.nombre IN ('administrador', 'bodega')
         AND ($1::uuid IS NULL OR u.id <> $1::uuid)`,
      [solicitanteId]
    );
    await enviarAVarios(rows, {
      titulo: `📦 Pedido a bodega — ${nombreFinca}`,
      mensaje: texto.trim().slice(0, 300) || 'Nuevo pedido a bodega.',
      url: './',
      modulo: 'pedidos-bodega',
    });
  } catch (err) {
    console.error('[push] Error preparando notificación de pedido a bodega:', err instanceof Error ? err.message : err);
  }
}

export async function notificarIncidenciaUrgente(fincaId: string, descripcion: string) {
  if (!habilitado) return;
  try {
    const { rows } = await pool.query('SELECT nombre FROM fincas WHERE id = $1', [fincaId]);
    const nombreFinca = rows[0]?.nombre ?? 'una finca';
    await notificarFinca(fincaId, {
      titulo: `🚨 Incidencia urgente — ${nombreFinca}`,
      mensaje: descripcion?.trim() || 'Se reportó una incidencia urgente.',
      url: './',
    });
  } catch (err) {
    console.error('[push] Error preparando notificación de incidencia:', err instanceof Error ? err.message : err);
  }
}
