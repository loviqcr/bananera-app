import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { registrarAuditoria } from './auditService';
import { REGISTRO_SYNC } from './syncRegistry';
import type { UsuarioAutenticado } from '../types/express';
import { tieneAccesoAFinca } from '../middleware/auth';

export interface OperacionSync {
  tabla: string;
  operacion: 'crear' | 'editar' | 'eliminar';
  id: string;
  datos?: Record<string, unknown>;
  actualizadoEn?: string; // ISO timestamp asignado por el dispositivo al guardar
  dispositivoId?: string;
}

export interface ResultadoOperacion {
  tabla: string;
  id: string;
  estado: 'ok' | 'rechazado' | 'error';
  motivo?: string;
}

/**
 * Aplica una operación de sync respetando la estrategia de conflicto de la
 * tabla. Nunca lanza para errores "esperables" (permiso, validación) — los
 * devuelve como resultado 'rechazado' para que el cliente decida qué hacer
 * (mostrar el error, no reintentar). Errores de infraestructura sí se
 * relanzan para que la transacción del lote se revierta.
 */
export async function aplicarOperacion(
  client: PoolClient,
  usuario: UsuarioAutenticado,
  op: OperacionSync
): Promise<ResultadoOperacion> {
  const registro = REGISTRO_SYNC[op.tabla];
  if (!registro) {
    return { tabla: op.tabla, id: op.id, estado: 'rechazado', motivo: 'Tabla no sincronizable' };
  }
  if (!registro.rolesEscritura.includes(usuario.rol)) {
    return { tabla: op.tabla, id: op.id, estado: 'rechazado', motivo: 'Rol sin permiso de escritura' };
  }

  if (op.operacion === 'eliminar') {
    if (!registro.permiteEliminar) {
      return { tabla: op.tabla, id: op.id, estado: 'rechazado', motivo: 'Esta tabla no permite eliminar por sync' };
    }
    return eliminarConLww(client, usuario, registro, op);
  }

  if (!op.datos) {
    return { tabla: op.tabla, id: op.id, estado: 'rechazado', motivo: 'datos es requerido para crear/editar' };
  }

  if (registro.fincaScoped) {
    const fincaId = (op.datos.finca_id as string) ?? null;
    if (!fincaId) {
      return { tabla: op.tabla, id: op.id, estado: 'rechazado', motivo: 'finca_id es requerido' };
    }
    if (!tieneAccesoAFinca(usuario, fincaId)) {
      return { tabla: op.tabla, id: op.id, estado: 'rechazado', motivo: 'Sin acceso a esa finca' };
    }
  }

  return upsertConEstrategia(client, usuario, registro, op);
}

async function upsertConEstrategia(
  client: PoolClient,
  usuario: UsuarioAutenticado,
  registro: (typeof REGISTRO_SYNC)[string],
  op: OperacionSync
): Promise<ResultadoOperacion> {
  const columnas = registro.columnas.filter((c) => c in (op.datos as object));
  const valores = columnas.map((c) => (op.datos as Record<string, unknown>)[c]);
  const actualizadoEn = op.actualizadoEn ? new Date(op.actualizadoEn) : new Date();

  const anterior = await client.query(`SELECT * FROM ${registro.tabla} WHERE id = $1`, [op.id]);

  if (registro.conflictStrategy === 'append_only' && anterior.rowCount && anterior.rowCount > 0) {
    // Ya existe: en tablas de solo-agregar no se sobreescribe por sync.
    return { tabla: op.tabla, id: op.id, estado: 'ok' };
  }

  const nombresColumnas = ['id', 'creado_por', 'dispositivo_id', 'updated_at', ...columnas];
  const placeholders = nombresColumnas.map((_, i) => `$${i + 1}`);
  const valoresFinales = [op.id, usuario.id, op.dispositivoId ?? null, actualizadoEn, ...valores];

  let sql: string;
  if (registro.conflictStrategy === 'lww') {
    const setClause = columnas.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    sql = `
      INSERT INTO ${registro.tabla} (${nombresColumnas.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO UPDATE SET
        ${setClause}${setClause ? ',' : ''}
        updated_at = EXCLUDED.updated_at,
        dispositivo_id = EXCLUDED.dispositivo_id
      WHERE ${registro.tabla}.updated_at <= EXCLUDED.updated_at
      RETURNING id;
    `;
  } else {
    // append_only y kardex: solo INSERT (kardex real se maneja en su propio
    // servicio cuando se implemente esa fase; aquí se deja el camino simple).
    sql = `
      INSERT INTO ${registro.tabla} (${nombresColumnas.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO NOTHING
      RETURNING id;
    `;
  }

  const resultado = await client.query(sql, valoresFinales);

  if (resultado.rowCount === 0 && registro.conflictStrategy === 'lww') {
    // Existía un registro más reciente en el servidor: no es un error, es
    // el resultado esperado de last-write-wins. Se registra igual para
    // trazabilidad y el cliente debe hacer pull para quedarse con la
    // versión vigente.
    await registrarAuditoria({
      tabla: registro.tabla,
      registroId: op.id,
      usuarioId: usuario.id,
      accion: 'conflicto_resuelto',
      datosAnteriores: anterior.rows[0] ?? null,
      datosNuevos: op.datos,
      client,
    });
    return { tabla: op.tabla, id: op.id, estado: 'ok', motivo: 'Version del servidor era más reciente (LWW)' };
  }

  await registrarAuditoria({
    tabla: registro.tabla,
    registroId: op.id,
    usuarioId: usuario.id,
    accion: anterior.rowCount && anterior.rowCount > 0 ? 'editar' : 'crear',
    datosAnteriores: anterior.rows[0] ?? null,
    datosNuevos: op.datos,
    client,
  });

  return { tabla: op.tabla, id: op.id, estado: 'ok' };
}

async function eliminarConLww(
  client: PoolClient,
  usuario: UsuarioAutenticado,
  registro: (typeof REGISTRO_SYNC)[string],
  op: OperacionSync
): Promise<ResultadoOperacion> {
  const actualizadoEn = op.actualizadoEn ? new Date(op.actualizadoEn) : new Date();
  const anterior = await client.query(`SELECT * FROM ${registro.tabla} WHERE id = $1`, [op.id]);
  if (!anterior.rowCount) {
    return { tabla: op.tabla, id: op.id, estado: 'ok', motivo: 'No existía en el servidor' };
  }
  if (registro.fincaScoped) {
    const fincaId = anterior.rows[0].finca_id as string;
    if (!tieneAccesoAFinca(usuario, fincaId)) {
      return { tabla: op.tabla, id: op.id, estado: 'rechazado', motivo: 'Sin acceso a esa finca' };
    }
  }
  await client.query(
    `UPDATE ${registro.tabla}
     SET eliminado_at = $2, updated_at = $2
     WHERE id = $1 AND updated_at <= $2`,
    [op.id, actualizadoEn]
  );
  await registrarAuditoria({
    tabla: registro.tabla,
    registroId: op.id,
    usuarioId: usuario.id,
    accion: 'eliminar',
    datosAnteriores: anterior.rows[0],
    client,
  });
  return { tabla: op.tabla, id: op.id, estado: 'ok' };
}

/**
 * Devuelve, para cada tabla registrada a la que el usuario tenga acceso,
 * las filas cuyo updated_at sea posterior a `desde` (o todas si no se envía
 * `desde`, es decir la primera sincronización del dispositivo).
 */
export async function obtenerCambiosPendientes(
  usuario: UsuarioAutenticado,
  desde: Date | null
): Promise<Record<string, unknown[]>> {
  const resultado: Record<string, unknown[]> = {};

  for (const registro of Object.values(REGISTRO_SYNC)) {
    const condiciones: string[] = [];
    const valores: unknown[] = [];

    if (desde) {
      valores.push(desde);
      condiciones.push(`updated_at > $${valores.length}`);
    }

    if (registro.fincaScoped && usuario.fincaIds.length > 0) {
      valores.push(usuario.fincaIds);
      condiciones.push(`finca_id = ANY($${valores.length})`);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const { rows } = await pool.query(`SELECT * FROM ${registro.tabla} ${where} ORDER BY updated_at`, valores);
    resultado[registro.tabla] = rows;
  }

  return resultado;
}
