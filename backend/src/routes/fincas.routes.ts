import { Router } from 'express';
import { pool } from '../db/pool';
import { requiereAutenticacion, requiereRol, tieneAccesoAFinca } from '../middleware/auth';

export const fincasRouter = Router();
fincasRouter.use(requiereAutenticacion);

// Las 4 fincas siempre son visibles para todo usuario autenticado: el
// selector de finca (sección 1 del prompt) necesita listarlas todas aunque
// el usuario solo pueda operar dentro de una. El control de qué puede EDITAR
// dentro de una finca ocurre en cada módulo, no aquí.
fincasRouter.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, orden FROM fincas WHERE eliminado_at IS NULL ORDER BY orden'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Renombrar una finca (nombre editable, según sección 1 del prompt).
// Solo administrador.
fincasRouter.patch('/:id', requiereRol('administrador'), async (req, res, next) => {
  try {
    const { nombre } = req.body as { nombre?: string };
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'nombre es requerido' });
    }
    const { rows } = await pool.query(
      'UPDATE fincas SET nombre = $1 WHERE id = $2 AND eliminado_at IS NULL RETURNING id, nombre, orden',
      [nombre.trim(), req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Finca no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

fincasRouter.get('/:id/areas', async (req, res, next) => {
  try {
    const usuario = req.usuario!;
    if (!tieneAccesoAFinca(usuario, req.params.id)) {
      return res.status(403).json({ error: 'No tienes acceso a esta finca' });
    }
    const { rows } = await pool.query(
      'SELECT id, finca_id, nombre, orden FROM areas WHERE finca_id = $1 AND eliminado_at IS NULL ORDER BY orden',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

fincasRouter.post('/:id/areas', requiereRol('administrador', 'encargado_finca'), async (req, res, next) => {
  try {
    const usuario = req.usuario!;
    const fincaId = req.params.id;
    if (!tieneAccesoAFinca(usuario, fincaId)) {
      return res.status(403).json({ error: 'No tienes acceso a esta finca' });
    }
    const { id, nombre, orden } = req.body as { id?: string; nombre?: string; orden?: number };
    if (!id || !nombre) {
      return res.status(400).json({ error: 'id (UUID generado en el dispositivo) y nombre son requeridos' });
    }
    const { rows } = await pool.query(
      `INSERT INTO areas (id, finca_id, nombre, orden, creado_por)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, orden = EXCLUDED.orden
       RETURNING id, finca_id, nombre, orden`,
      [id, fincaId, nombre, orden ?? 0, usuario.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});
