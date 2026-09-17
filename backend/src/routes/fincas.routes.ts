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

// Agregar una finca nueva. Solo administrador. Las fincas nunca pasaron por
// el motor de sync genérico (son pocas filas, se editan poco — ver la nota
// en frontend/js/modules/fincas.js), así que esto requiere conexión, igual
// que renombrar. Se crea también su bodega propia (tipo 'finca') en la
// misma transacción — sin esto, Inventario > Bodegas no tendría dónde
// guardar los movimientos de esta finca (ver migración 002, que agregó esto
// mismo para las 4 fincas originales).
fincasRouter.post('/', requiereRol('administrador'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { nombre } = req.body as { nombre?: string };
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'nombre es requerido' });
    }
    await client.query('BEGIN');
    const { rows: ordenRows } = await client.query('SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM fincas');
    const orden = ordenRows[0].siguiente;
    const { rows } = await client.query(
      `INSERT INTO fincas (nombre, orden, creado_por) VALUES ($1, $2, $3) RETURNING id, nombre, orden`,
      [nombre.trim(), orden, req.usuario!.id]
    );
    const finca = rows[0];
    await client.query(
      `INSERT INTO bodegas (id, finca_id, tipo, nombre, creado_por) VALUES (gen_random_uuid(), $1, 'finca', $2, $3)`,
      [finca.id, `Bodega ${finca.nombre}`, req.usuario!.id]
    );
    await client.query('COMMIT');
    res.status(201).json(finca);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
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
