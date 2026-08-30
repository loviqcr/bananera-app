import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db/pool';
import { firmarAccessToken, firmarRefreshToken, verificarRefreshToken } from '../utils/jwt';
import type { UsuarioAutenticado } from '../types/express';

export const authRouter = Router();

const loginSchema = z.object({
  usuario: z.string().min(1),
  password: z.string().min(1),
});

async function cargarUsuarioAutenticado(usuarioId: string): Promise<UsuarioAutenticado | null> {
  const { rows } = await pool.query(
    `SELECT u.id, u.usuario, u.nombre, r.nombre AS rol
     FROM usuarios u
     JOIN roles r ON r.id = u.rol_id
     WHERE u.id = $1 AND u.activo = true AND u.eliminado_at IS NULL`,
    [usuarioId]
  );
  if (rows.length === 0) return null;
  const fila = rows[0];

  const fincasResult = await pool.query('SELECT finca_id FROM usuario_fincas WHERE usuario_id = $1', [usuarioId]);
  // administrador y bodega ven todas las fincas aunque no tengan filas en usuario_fincas
  const fincaIds =
    fila.rol === 'administrador' || fila.rol === 'bodega' ? [] : fincasResult.rows.map((r) => r.finca_id);

  return { id: fila.id, usuario: fila.usuario, nombre: fila.nombre, rol: fila.rol, fincaIds };
}

authRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'usuario y password son requeridos' });
    }
    const { usuario, password } = parsed.data;

    const { rows } = await pool.query(
      `SELECT id, password_hash FROM usuarios
       WHERE usuario = $1 AND activo = true AND eliminado_at IS NULL`,
      [usuario]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const coincide = await bcrypt.compare(password, rows[0].password_hash);
    if (!coincide) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const usuarioAutenticado = await cargarUsuarioAutenticado(rows[0].id);
    if (!usuarioAutenticado) {
      return res.status(401).json({ error: 'Usuario no disponible' });
    }

    const accessToken = firmarAccessToken(usuarioAutenticado);
    const refreshToken = firmarRefreshToken(usuarioAutenticado.id);

    res.json({ accessToken, refreshToken, usuario: usuarioAutenticado });
  } catch (err) {
    next(err);
  }
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'refreshToken es requerido' });
    }
    let payload: { id: string };
    try {
      payload = verificarRefreshToken(parsed.data.refreshToken);
    } catch {
      return res.status(401).json({ error: 'refreshToken inválido o expirado' });
    }
    const usuarioAutenticado = await cargarUsuarioAutenticado(payload.id);
    if (!usuarioAutenticado) {
      return res.status(401).json({ error: 'Usuario no disponible' });
    }
    const accessToken = firmarAccessToken(usuarioAutenticado);
    res.json({ accessToken, usuario: usuarioAutenticado });
  } catch (err) {
    next(err);
  }
});
