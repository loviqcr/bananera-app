import { Router } from 'express';
import { pool } from '../db/pool';
import { requiereAutenticacion, requiereRol } from '../middleware/auth';
import { REGISTRO_SYNC } from '../services/syncRegistry';

export const respaldoRouter = Router();
respaldoRouter.use(requiereAutenticacion, requiereRol('administrador'));

/**
 * Respaldo completo de los datos, solo para administrador: todas las tablas
 * sincronizables (incluyendo los registros marcados como eliminados, para no
 * perder historial) más usuarios y sus fincas. NUNCA incluye contraseñas ni
 * PIN (password_hash/pin_hash) — el archivo se guarda en un celular o correo
 * y no debe poder usarse para entrar a la app; los usuarios se vuelven a
 * crear con clave nueva al restaurar. Los nombres de tabla salen del registro
 * de sync (no de la petición), así que no hay forma de inyectar SQL.
 */
respaldoRouter.get('/', async (_req, res, next) => {
  try {
    const tablas: Record<string, unknown[]> = {};
    for (const definicion of Object.values(REGISTRO_SYNC)) {
      const { rows } = await pool.query(`SELECT * FROM ${definicion.tabla}`);
      tablas[definicion.tabla] = rows;
    }

    const [usuarios, usuarioFincas] = await Promise.all([
      pool.query(
        `SELECT u.id, u.nombre, u.usuario, r.nombre AS rol, u.activo, u.created_at, u.eliminado_at
         FROM usuarios u JOIN roles r ON r.id = u.rol_id`
      ),
      pool.query('SELECT usuario_id, finca_id FROM usuario_fincas'),
    ]);

    const resumen = Object.fromEntries(Object.entries(tablas).map(([tabla, filas]) => [tabla, filas.length]));
    const fecha = new Date().toISOString();

    res.setHeader('Content-Disposition', `attachment; filename="respaldo-cosechas-${fecha.slice(0, 10)}.json"`);
    res.json({
      generado: fecha,
      version: 1,
      resumen,
      tablas,
      usuarios: usuarios.rows,
      usuario_fincas: usuarioFincas.rows,
    });
  } catch (err) {
    next(err);
  }
});
