import type { PoolClient } from 'pg';
import { pool } from '../db/pool';

interface RegistrarAuditoriaParams {
  tabla: string;
  registroId: string;
  usuarioId: string | null;
  accion: 'crear' | 'editar' | 'eliminar' | 'conflicto_resuelto';
  datosAnteriores?: unknown;
  datosNuevos?: unknown;
  client?: PoolClient;
}

export async function registrarAuditoria(params: RegistrarAuditoriaParams): Promise<void> {
  const runner = params.client ?? pool;
  await runner.query(
    `INSERT INTO audit_logs (tabla, registro_id, usuario_id, accion, datos_anteriores, datos_nuevos)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.tabla,
      params.registroId,
      params.usuarioId,
      params.accion,
      params.datosAnteriores ? JSON.stringify(params.datosAnteriores) : null,
      params.datosNuevos ? JSON.stringify(params.datosNuevos) : null,
    ]
  );
}
