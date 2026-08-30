-- equipos.codigo y empleados.codigo tienen UNIQUE(codigo) simple, pero el
-- borrado de ambas tablas es lógico (eliminado_at), no físico. Eso significa
-- que "eliminar" un equipo o empleado y luego querer reusar su código (algo
-- normal: un trabajador se va y se reemplaza con el mismo código de gafete,
-- o un equipo dado de baja se reemplaza) choca contra el UNIQUE y el alta
-- nueva se rechaza con 23505 sin explicación clara para quien lo intenta.
-- Se reemplaza por un índice único parcial que solo aplica a filas activas.

ALTER TABLE equipos DROP CONSTRAINT IF EXISTS equipos_codigo_key;
CREATE UNIQUE INDEX IF NOT EXISTS equipos_codigo_activo_key
  ON equipos (codigo) WHERE eliminado_at IS NULL;

ALTER TABLE empleados DROP CONSTRAINT IF EXISTS empleados_codigo_key;
CREATE UNIQUE INDEX IF NOT EXISTS empleados_codigo_activo_key
  ON empleados (codigo) WHERE eliminado_at IS NULL;
