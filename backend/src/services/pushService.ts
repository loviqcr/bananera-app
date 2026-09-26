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

export interface OperacionCreada {
  tabla: string;
  datos: Record<string, unknown>;
}

const numero = (v: unknown) => Number(v) || 0;
const formato = (n: number) => n.toLocaleString('es-CR');

/**
 * Aviso a los administradores cuando alguien registra embolse, corta o una
 * Entrega de Carga. Se agrupa por lote de sync y por finca: si un celular
 * sube de golpe 30 registros al recuperar señal, llega UN aviso por finca y
 * tipo con los totales, no 30. Nunca se avisa a quien hizo el registro (si
 * el administrador registra algo, no necesita que se lo digan).
 * "Entrega de Carga" = entregas_platano con grupo_entrega; las entregas de
 * Producción (sin grupo) no avisan.
 */
export async function notificarActividad(operaciones: OperacionCreada[], actorId: string) {
  if (!habilitado || operaciones.length === 0) return;
  try {
    const embolse = new Map<string, { registros: number; total: number; variedades: Map<string, number> }>();
    const corta = new Map<string, { registros: number; total: number }>();
    const entrega = new Map<string, { primera: number; segunda: number; destinatarios: Set<string> }>();

    for (const { tabla, datos } of operaciones) {
      const fincaId = datos.finca_id as string | undefined;
      if (!fincaId) continue;
      if (tabla === 'embolse') {
        const actual = embolse.get(fincaId) ?? { registros: 0, total: 0, variedades: new Map() };
        const cantidad = numero(datos.cantidad);
        actual.registros += 1;
        actual.total += cantidad;
        const variedad = /\[Variedad: ([^\]]+)\]/.exec(String(datos.observaciones ?? ''))?.[1];
        if (variedad) actual.variedades.set(variedad, (actual.variedades.get(variedad) ?? 0) + cantidad);
        embolse.set(fincaId, actual);
      } else if (tabla === 'corta') {
        const actual = corta.get(fincaId) ?? { registros: 0, total: 0 };
        actual.registros += 1;
        actual.total += numero(datos.racimos_cortados);
        corta.set(fincaId, actual);
      } else if (tabla === 'entregas_platano' && datos.grupo_entrega) {
        const actual = entrega.get(fincaId) ?? { primera: 0, segunda: 0, destinatarios: new Set() };
        if (datos.calidad === 'primera') actual.primera += numero(datos.cantidad_cajas);
        if (datos.calidad === 'segunda') actual.segunda += numero(datos.cantidad_cajas);
        if (datos.responsable_nombre) actual.destinatarios.add(String(datos.responsable_nombre));
        entrega.set(fincaId, actual);
      }
    }

    const fincaIds = [...new Set([...embolse.keys(), ...corta.keys(), ...entrega.keys()])];
    if (fincaIds.length === 0) return;
    const { rows: fincaRows } = await pool.query('SELECT id, nombre FROM fincas WHERE id = ANY($1::uuid[])', [fincaIds]);
    const nombreFinca = (id: string) => fincaRows.find((f) => f.id === id)?.nombre ?? 'una finca';

    const avisos: { titulo: string; mensaje: string; modulo: string }[] = [];
    for (const [fincaId, e] of embolse) {
      const porVariedad = [...e.variedades].map(([v, n]) => `${v} ${formato(n)}`).join(' · ');
      avisos.push({ titulo: `🎗️ Embolse — ${nombreFinca(fincaId)}`, mensaje: `${formato(e.total)} racimos embolsados${porVariedad ? ` (${porVariedad})` : ''}`, modulo: 'embolse-corta' });
    }
    for (const [fincaId, c] of corta) {
      avisos.push({ titulo: `✂️ Corta — ${nombreFinca(fincaId)}`, mensaje: `${formato(c.total)} racimos cortados`, modulo: 'embolse-corta' });
    }
    for (const [fincaId, e] of entrega) {
      const destino = e.destinatarios.size > 0 ? ` → ${[...e.destinatarios].join(', ')}` : '';
      avisos.push({ titulo: `🧺 Entrega de carga — ${nombreFinca(fincaId)}`, mensaje: `${formato(e.primera)} de primera · ${formato(e.segunda)} de segunda${destino}`, modulo: 'entrega-carga' });
    }

    const { rows } = await pool.query(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
       FROM push_subscriptions ps
       JOIN usuarios u ON u.id = ps.usuario_id
       JOIN roles r ON r.id = u.rol_id
       WHERE u.eliminado_at IS NULL AND u.activo = true
         AND r.nombre = 'administrador'
         AND u.id <> $1::uuid`,
      [actorId]
    );
    for (const aviso of avisos) {
      await enviarAVarios(rows, { titulo: aviso.titulo, mensaje: aviso.mensaje, url: './', modulo: aviso.modulo });
    }
  } catch (err) {
    console.error('[push] Error preparando aviso de actividad:', err instanceof Error ? err.message : err);
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
