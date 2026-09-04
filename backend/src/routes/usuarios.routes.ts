import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requiereAutenticacion, requiereRol } from '../middleware/auth';

export const usuariosRouter = Router();
usuariosRouter.use(requiereAutenticacion, requiereRol('administrador'));

usuariosRouter.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, u.activo, r.nombre AS rol,
              array_remove(array_agg(uf.finca_id), NULL) AS finca_ids
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       LEFT JOIN usuario_fincas uf ON uf.usuario_id = u.id
       WHERE u.eliminado_at IS NULL
       GROUP BY u.id, u.nombre, u.usuario, u.activo, r.nombre
       ORDER BY u.nombre`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const crearUsuarioSchema = z.object({
  nombre: z.string().min(1),
  usuario: z.string().min(3),
  password: z.string().min(6),
  rol: z.enum(['administrador', 'encargado_finca', 'bodega', 'planilla', 'trabajador']),
  fincaIds: z.array(z.string().uuid()).optional(),
});

usuariosRouter.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const parsed = crearUsuarioSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos', detalle: parsed.error.issues });
    }
    const { nombre, usuario, password, rol, fincaIds } = parsed.data;

    const rolRow = await pool.query('SELECT id FROM roles WHERE nombre = $1', [rol]);
    if (rolRow.rowCount === 0) return res.status(400).json({ error: 'Rol desconocido' });

    const passwordHash = await bcrypt.hash(password, 10);

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO usuarios (nombre, usuario, password_hash, rol_id, creado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre, usuario`,
      [nombre, usuario, passwordHash, rolRow.rows[0].id, req.usuario!.id]
    );
    const nuevoId = rows[0].id;
    for (const fincaId of fincaIds ?? []) {
      await client.query('INSERT INTO usuario_fincas (usuario_id, finca_id) VALUES ($1, $2)', [nuevoId, fincaId]);
    }
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof Error && /unique/i.test(err.message)) {
      return res.status(409).json({ error: 'Ese nombre de usuario ya existe' });
    }
    next(err);
  } finally {
    client.release();
  }
});

const actualizarUsuarioSchema = z
  .object({
    rol: z.enum(['administrador', 'encargado_finca', 'bodega', 'planilla', 'trabajador']),
    fincaIds: z.array(z.string().uuid()),
    activo: z.boolean(),
  })
  .partial()
  .refine((datos) => Object.keys(datos).length > 0, { message: 'No hay nada que actualizar' });

/**
 * Edita rol, fincas asignadas y/o estado activo de un usuario ya creado.
 * Cada campo es independiente: se puede mandar solo `fincaIds` para
 * reasignar fincas sin tocar el rol, por ejemplo.
 */
usuariosRouter.patch('/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const parsed = actualizarUsuarioSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos', detalle: parsed.error.issues });
    }
    const { rol, fincaIds, activo } = parsed.data;

    await client.query('BEGIN');

    const usuarioExistente = await client.query(
      'SELECT id FROM usuarios WHERE id = $1 AND eliminado_at IS NULL',
      [req.params.id]
    );
    if (usuarioExistente.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (rol) {
      const rolRow = await client.query('SELECT id FROM roles WHERE nombre = $1', [rol]);
      if (rolRow.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Rol desconocido' });
      }
      await client.query('UPDATE usuarios SET rol_id = $1 WHERE id = $2', [rolRow.rows[0].id, req.params.id]);
    }

    if (activo !== undefined) {
      await client.query('UPDATE usuarios SET activo = $1 WHERE id = $2', [activo, req.params.id]);
    }

    if (fincaIds) {
      await client.query('DELETE FROM usuario_fincas WHERE usuario_id = $1', [req.params.id]);
      for (const fincaId of fincaIds) {
        await client.query('INSERT INTO usuario_fincas (usuario_id, finca_id) VALUES ($1, $2)', [req.params.id, fincaId]);
      }
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT u.id, u.nombre, u.usuario, u.activo, r.nombre AS rol,
              array_remove(array_agg(uf.finca_id), NULL) AS finca_ids
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       LEFT JOIN usuario_fincas uf ON uf.usuario_id = u.id
       WHERE u.id = $1
       GROUP BY u.id, u.nombre, u.usuario, u.activo, r.nombre`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});
