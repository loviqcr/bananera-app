import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requiereAutenticacion } from '../middleware/auth';
import { aplicarOperacion, obtenerCambiosPendientes, type OperacionSync } from '../services/syncService';
import { notificarIncidenciaUrgente, notificarPedidoBodega } from '../services/pushService';

export const syncRouter = Router();
syncRouter.use(requiereAutenticacion);

const operacionSchema = z.object({
  tabla: z.string(),
  operacion: z.enum(['crear', 'editar', 'eliminar']),
  id: z.string().uuid(),
  datos: z.record(z.unknown()).optional(),
  actualizadoEn: z.string().optional(),
  dispositivoId: z.string().optional(),
});

const pushSchema = z.object({
  operaciones: z.array(operacionSchema).min(1).max(200),
});

/**
 * Recibe un lote de operaciones encoladas por el dispositivo mientras
 * estuvo sin conexión (o generadas en línea, da igual: el flujo es el
 * mismo). Cada operación se procesa en su propia transacción para que un
 * ítem inválido no tumbe el resto del lote — el cliente marca cada id según
 * el resultado individual y solo saca de su cola local los que quedaron
 * 'ok'.
 */
syncRouter.post('/push', async (req, res, next) => {
  try {
    const parsed = pushSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Formato de lote inválido', detalle: parsed.error.issues });
    }
    const usuario = req.usuario!;
    const resultados = [];

    for (const op of parsed.data.operaciones as OperacionSync[]) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const resultado = await aplicarOperacion(client, usuario, op);
        await client.query('COMMIT');
        resultados.push(resultado);

        // Aviso push (no bloquea la respuesta ni afecta el resultado de la
        // operación si falla — es un "extra", no parte de guardar el dato).
        if (resultado.estado === 'ok' && op.tabla === 'incidencias' && op.operacion === 'crear' && op.datos?.prioridad === 'urgente') {
          const fincaId = op.datos.finca_id as string | undefined;
          const descripcion = op.datos.descripcion as string | undefined;
          if (fincaId) {
            notificarIncidenciaUrgente(fincaId, descripcion ?? '').catch((err) => {
              console.error('[sync] Error enviando notificación push:', err);
            });
          }
        }
        if (resultado.estado === 'ok' && op.tabla === 'pedidos_bodega' && op.operacion === 'crear') {
          const fincaId = op.datos?.finca_id as string | undefined;
          const texto = (op.datos?.texto as string | undefined) ?? '';
          if (fincaId) {
            notificarPedidoBodega(fincaId, texto, usuario.id).catch((err) => {
              console.error('[sync] Error enviando notificación push de pedido:', err);
            });
          }
        }
      } catch (err) {
        await client.query('ROLLBACK');
        resultados.push({
          tabla: op.tabla,
          id: op.id,
          estado: 'error' as const,
          motivo: err instanceof Error ? err.message : 'Error desconocido',
        });
      } finally {
        client.release();
      }
    }

    res.json({ resultados });
  } catch (err) {
    next(err);
  }
});

/**
 * Devuelve los cambios posteriores a `desde` (ISO 8601) para las tablas
 * sincronizables dentro del alcance del usuario, junto con `marca`: el
 * timestamp que el dispositivo debe guardar como su próximo `desde`.
 * Sin `desde`, devuelve todo (primera sincronización del dispositivo).
 */
syncRouter.get('/pull', async (req, res, next) => {
  try {
    const usuario = req.usuario!;
    const desdeParam = req.query.desde as string | undefined;
    const desde = desdeParam ? new Date(desdeParam) : null;
    if (desdeParam && Number.isNaN(desde?.getTime())) {
      return res.status(400).json({ error: 'desde debe ser una fecha ISO 8601 válida' });
    }

    const marca = new Date(); // se captura ANTES de consultar, para no perder cambios que ocurran durante la consulta
    const cambios = await obtenerCambiosPendientes(usuario, desde);

    res.json({ marca: marca.toISOString(), cambios });
  } catch (err) {
    next(err);
  }
});
