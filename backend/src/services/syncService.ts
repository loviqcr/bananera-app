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
    let fincaId = (op.datos.finca_id as string) ?? null;
    // En una edición parcial (repos.editar() del cliente solo envía los
    // campos que cambiaron) es normal que finca_id no venga en el payload
    // porque no cambió. En ese caso se busca la finca_id de la fila ya
    // existente en el servidor para validar el acceso, en vez de rechazar
    // toda edición que no repita finca_id innecesariamente.
    if (!fincaId && op.operacion === 'editar') {
      const filaActual = await client.query(`SELECT finca_id FROM ${registro.tabla} WHERE id = $1`, [op.id]);
      fincaId = (filaActual.rows[0]?.finca_id as string) ?? null;
    }
    if (!fincaId) {
      return { tabla: op.tabla, id: op.id, estado: 'rechazado', motivo: 'finca_id es requerido' };
    }
    if (!tieneAccesoAFinca(usuario, fincaId)) {
      return { tabla: op.tabla, id: op.id, estado: 'rechazado', motivo: 'Sin acceso a esa finca' };
    }
  }

  // Una edición (repos.editar() del cliente) manda solo los campos que
  // cambiaron, nunca la fila completa. El camino de 'crear' usa
  // INSERT ... ON CONFLICT DO UPDATE, pero Postgres evalúa las restricciones
  // NOT NULL de la fila candidata del INSERT *antes* de llegar siquiera a
  // resolver el conflicto — así que una edición parcial con ese mismo
  // camino truena contra cualquier columna NOT NULL sin default que no
  // venga en el diff (ej. editar solo `estado` de un equipo, que no manda
  // `codigo`/`nombre`/`tipo`/`finca_id`). Por eso una edición sobre una
  // tabla 'lww' se resuelve con un UPDATE real, que solo toca las columnas
  // presentes en el diff.
  if (op.operacion === 'editar' && registro.conflictStrategy === 'lww') {
    return editarConLww(client, usuario, registro, op);
  }

  return upsertConEstrategia(client, usuario, registro, op);
}

async function editarConLww(
  client: PoolClient,
  usuario: UsuarioAutenticado,
  registro: (typeof REGISTRO_SYNC)[string],
  op: OperacionSync
): Promise<ResultadoOperacion> {
  const columnas = registro.columnas.filter((c) => c in (op.datos as object));
  const actualizadoEn = op.actualizadoEn ? new Date(op.actualizadoEn) : new Date();

  let anterior = await client.query(`SELECT * FROM ${registro.tabla} WHERE id = $1`, [op.id]);
  let idServidor = op.id;

  // Si la tabla tiene llave natural (ej. asistencia: empleado_id+fecha) y el
  // id local no existe en el servidor, puede ser que este mismo registro ya
  // haya convergido en otra fila (otro dispositivo creó "lo mismo" offline y
  // el alta se resolvió por ON CONFLICT sobre la llave natural, quedándose
  // con un id distinto al de este dispositivo). Antes de descartar la
  // edición como "no existe", se busca por esa llave natural si el diff
  // trae esas columnas.
  if (!anterior.rowCount && registro.conflictColumns && registro.conflictColumns[0] !== 'id') {
    const datos = op.datos as Record<string, unknown>;
    const tieneLlaveNatural = registro.conflictColumns.every((c) => c in datos);
    if (tieneLlaveNatural) {
      anterior = await client.query(
        `SELECT * FROM ${registro.tabla} WHERE ${registro.conflictColumns.map((c, i) => `${c} = $${i + 1}`).join(' AND ')}`,
        registro.conflictColumns.map((c) => datos[c])
      );
      if (anterior.rowCount) {
        idServidor = anterior.rows[0].id as string;
      }
    }
  }

  if (!anterior.rowCount) {
    // La fila todavía no existe en el servidor — probablemente su 'crear'
    // sigue en la cola local o llegará en otro lote. No es un error: se
    // descarta sin reintentar y quedará correcta en cuanto llegue el alta.
    return { tabla: op.tabla, id: op.id, estado: 'ok', motivo: 'El registro aún no existe en el servidor' };
  }

  if (columnas.length === 0) {
    return { tabla: op.tabla, id: op.id, estado: 'ok', motivo: 'Sin cambios que aplicar' };
  }

  const asignaciones = columnas.map((c, i) => `${c} = $${i + 4}`);
  const valores = columnas.map((c) => (op.datos as Record<string, unknown>)[c]);
  const sql = `
    UPDATE ${registro.tabla}
    SET updated_at = $2, dispositivo_id = $3, ${asignaciones.join(', ')}
    WHERE id = $1 AND updated_at <= $2
    RETURNING id;
  `;
  const resultado = await client.query(sql, [idServidor, actualizadoEn, op.dispositivoId ?? null, ...valores]);

  if (resultado.rowCount === 0) {
    // La fila del servidor es más reciente que esta edición (LWW) — no es
    // un error, el cliente se pondrá al día con el próximo pull.
    await registrarAuditoria({
      tabla: registro.tabla,
      registroId: op.id,
      usuarioId: usuario.id,
      accion: 'conflicto_resuelto',
      datosAnteriores: anterior.rows[0],
      datosNuevos: op.datos,
      client,
    });
    return { tabla: op.tabla, id: op.id, estado: 'ok', motivo: 'Version del servidor era más reciente (LWW)' };
  }

  await registrarAuditoria({
    tabla: registro.tabla,
    registroId: op.id,
    usuarioId: usuario.id,
    accion: 'editar',
    datosAnteriores: anterior.rows[0],
    datosNuevos: op.datos,
    client,
  });
  return { tabla: op.tabla, id: op.id, estado: 'ok' };
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
  const conflictCols = registro.conflictColumns ?? ['id'];

  // Cuando la llave de conflicto NO es el id (ej. asistencia por
  // empleado+fecha), hay que buscar la fila "anterior" por esa llave
  // natural, porque dos dispositivos offline pudieron generar UUIDs
  // distintos para lo que en el servidor debe ser una sola fila.
  const anterior =
    conflictCols.length === 1 && conflictCols[0] === 'id'
      ? await client.query(`SELECT * FROM ${registro.tabla} WHERE id = $1`, [op.id])
      : await client.query(
          `SELECT * FROM ${registro.tabla} WHERE ${conflictCols.map((c, i) => `${c} = $${i + 1}`).join(' AND ')}`,
          conflictCols.map((c) => (op.datos as Record<string, unknown>)[c])
        );

  if (registro.conflictStrategy === 'append_only' && anterior.rowCount && anterior.rowCount > 0) {
    // Ya existe: en tablas de solo-agregar no se sobreescribe por sync.
    return { tabla: op.tabla, id: op.id, estado: 'ok' };
  }

  const nombresColumnas = ['id', 'creado_por', 'dispositivo_id', 'updated_at', ...columnas];
  const placeholders = nombresColumnas.map((_, i) => `$${i + 1}`);
  const valoresFinales = [op.id, usuario.id, op.dispositivoId ?? null, actualizadoEn, ...valores];
  const objetivoConflicto = conflictCols.join(', ');

  let sql: string;
  if (registro.conflictStrategy === 'lww') {
    // "id" nunca entra en el SET: si el conflicto fue por llave natural
    // (no por id), la fila existente conserva su id original — así dos
    // altas offline para "lo mismo" convergen en una sola fila.
    const setClause = columnas.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    sql = `
      INSERT INTO ${registro.tabla} (${nombresColumnas.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (${objetivoConflicto}) DO UPDATE SET
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
      ON CONFLICT (${objetivoConflicto}) DO NOTHING
      RETURNING id;
    `;
  }

  let resultado;
  try {
    resultado = await client.query(sql, valoresFinales);
  } catch (err) {
    // 23505 = unique_violation de Postgres: la tabla tiene además otra
    // restricción UNIQUE distinta a la llave de conflicto usada aquí (ej.
    // equipos.codigo, empleados.codigo). No es un fallo de infraestructura
    // — es un dato inválido — así que se devuelve 'rechazado' en vez de
    // dejar que la operación quede reintentándose para siempre en la cola.
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505') {
      return {
        tabla: op.tabla,
        id: op.id,
        estado: 'rechazado',
        motivo: 'Ya existe otro registro con ese mismo valor único (por ejemplo, un código duplicado)',
      };
    }
    throw err;
  }

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
  const resultado = await client.query(
    `UPDATE ${registro.tabla}
     SET eliminado_at = $2, updated_at = $2
     WHERE id = $1 AND updated_at <= $2
     RETURNING id`,
    [op.id, actualizadoEn]
  );

  if (resultado.rowCount === 0) {
    // Existía una versión más reciente en el servidor: no se borró, es el
    // resultado esperado de last-write-wins. El cliente debe hacer pull.
    await registrarAuditoria({
      tabla: registro.tabla,
      registroId: op.id,
      usuarioId: usuario.id,
      accion: 'conflicto_resuelto',
      datosAnteriores: anterior.rows[0],
      client,
    });
    return { tabla: op.tabla, id: op.id, estado: 'ok', motivo: 'Version del servidor era más reciente (LWW)' };
  }

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
    if (registro.rolesLectura && !registro.rolesLectura.includes(usuario.rol)) {
      continue; // datos sensibles (nómina, precios) que este rol no debe recibir
    }

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
