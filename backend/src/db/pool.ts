import { Pool, types } from 'pg';
import { env } from '../config/env';

// El driver `pg` por defecto parsea las columnas DATE (OID 1082) como
// objetos Date de JS. Al serializarlos con JSON.stringify (cualquier
// res.json()) se convierten en timestamps completos con hora
// ("2026-08-30T00:00:00.000Z") en vez de "2026-08-30". Eso rompe cualquier
// comparación exacta de fecha en el frontend después de un sync (ej.
// `fila.fecha === hoyISO()` en los cálculos de "hoy" del dashboard,
// laboresConEstado, o el upsert por natural-key de asistencia), porque un
// dispositivo compara el string plano que él mismo generó contra el string
// con hora que le llegó del servidor y nunca coinciden. Se fuerza a que
// las columnas DATE viajen como texto plano "YYYY-MM-DD" tal cual las
// devuelve Postgres, sin pasar por el constructor Date.
types.setTypeParser(1082, (val) => val);

export const pool = new Pool({
  connectionString: env.databaseUrl,
});

pool.on('error', (err) => {
  // Un error en un cliente inactivo del pool no debe tumbar el proceso.
  console.error('[db] Error inesperado en cliente inactivo del pool', err);
});

export async function withTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
