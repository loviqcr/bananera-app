/**
 * Runner de migraciones minimalista: ejecuta en orden los archivos .sql de
 * db/migrations/ que aún no se hayan aplicado, registrados en la tabla
 * schema_migrations. Se eligió esto en vez de un ORM/migrador de terceros
 * para que el SQL real quede legible y versionado en el repositorio.
 */
import fs from 'fs';
import path from 'path';
import { pool } from './pool';

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function appliedMigrations(): Promise<Set<string>> {
  const { rows } = await pool.query('SELECT id FROM schema_migrations');
  return new Set(rows.map((r) => r.id));
}

async function run() {
  await ensureMigrationsTable();
  const applied = await appliedMigrations();

  const dir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    if (applied.has(id)) {
      console.log(`[migrate] ${id} ya aplicada, se omite`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`[migrate] aplicando ${id}...`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
      await client.query('COMMIT');
      console.log(`[migrate] ${id} aplicada correctamente`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] error aplicando ${id}:`, err);
      process.exitCode = 1;
      throw err;
    } finally {
      client.release();
    }
  }

  await pool.end();
}

run().catch(() => process.exit(1));
