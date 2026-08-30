import { Router } from 'express';
import { pool } from '../db/pool';
import { requiereAutenticacion, requiereRol } from '../middleware/auth';

export const auditoriaRouter = Router();
auditoriaRouter.use(requiereAutenticacion, requiereRol('administrador'));

/**
 * Consulta de auditoría bajo demanda (Fase 9). A propósito NO se descarga
 * el historial completo a cada dispositivo por sync — solo el administrador
 * lo consulta aquí, en línea, con filtros. `audit_logs` puede crecer mucho
 * y contiene el detalle de cada cambio (datos_anteriores/datos_nuevos), así
 * que no tiene sentido cargarlo en IndexedDB de cada celular en campo.
 */
auditoriaRouter.get('/', async (req, res, next) => {
  try {
    const condiciones: string[] = [];
    const valores: unknown[] = [];

    if (req.query.tabla) {
      valores.push(req.query.tabla);
      condiciones.push(`a.tabla = $${valores.length}`);
    }
    if (req.query.desde) {
      valores.push(req.query.desde);
      condiciones.push(`a.fecha >= $${valores.length}`);
    }
    if (req.query.hasta) {
      valores.push(req.query.hasta);
      condiciones.push(`a.fecha <= $${valores.length}`);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT a.id, a.tabla, a.registro_id, a.accion, a.fecha, u.nombre AS usuario_nombre, u.usuario AS usuario_login
       FROM audit_logs a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       ${where}
       ORDER BY a.fecha DESC
       LIMIT 500`,
      valores
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});
