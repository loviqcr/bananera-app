import { Pool } from 'pg';
import { env } from '../config/env';

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
