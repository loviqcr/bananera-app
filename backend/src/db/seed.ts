/**
 * Crea (o actualiza la contraseña de) el usuario administrador inicial,
 * usando ADMIN_USUARIO / ADMIN_PASSWORD / ADMIN_NOMBRE de .env.
 * Se ejecuta con: npm run seed  (después de npm run migrate)
 */
import bcrypt from 'bcryptjs';
import { pool } from './pool';
import { env } from '../config/env';

const ROL_ADMINISTRADOR_ID = '00000000-0000-0000-0000-000000000001';

async function run() {
  const passwordHash = await bcrypt.hash(env.adminPassword, 10);

  const existing = await pool.query('SELECT id FROM usuarios WHERE usuario = $1', [env.adminUsuario]);

  if (existing.rowCount && existing.rowCount > 0) {
    await pool.query('UPDATE usuarios SET password_hash = $1, activo = true WHERE usuario = $2', [
      passwordHash,
      env.adminUsuario,
    ]);
    console.log(`[seed] Usuario administrador "${env.adminUsuario}" actualizado.`);
  } else {
    await pool.query(
      `INSERT INTO usuarios (id, nombre, usuario, password_hash, rol_id, activo)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, true)`,
      [env.adminNombre, env.adminUsuario, passwordHash, ROL_ADMINISTRADOR_ID]
    );
    console.log(`[seed] Usuario administrador "${env.adminUsuario}" creado.`);
  }

  console.log('[seed] Recuerda cambiar la contraseña temporal después del primer ingreso.');
  await pool.end();
}

run().catch((err) => {
  console.error('[seed] Error:', err);
  process.exit(1);
});
