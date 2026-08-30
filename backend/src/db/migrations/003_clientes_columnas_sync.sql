-- La tabla `clientes` se registró en REGISTRO_SYNC (Fase 7) como una tabla
-- sincronizable normal, pero su definición original en schema.sql se quedó
-- con solo (id, nombre, contacto) — nunca se le agregaron las columnas de
-- auditoría que el motor de sync asume para TODA tabla registrada
-- (creado_por, dispositivo_id, created_at, updated_at, eliminado_at).
-- Esto rompía /sync/pull por completo para cualquier dispositivo (la
-- consulta genérica hace `ORDER BY updated_at` sobre cada tabla registrada),
-- no solo la sincronización de clientes. Se corrige alineando `clientes`
-- con el mismo patrón que ya siguen todas las demás tablas sincronizables.

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS creado_por UUID REFERENCES usuarios(id);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS dispositivo_id TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS eliminado_at TIMESTAMPTZ;

-- Mismo problema exacto en otras tres tablas de catálogo/referencia que
-- también quedaron registradas en REGISTRO_SYNC (variedades, colores_cinta,
-- configuracion_frecuencias) pero se crearon en schema.sql como tablas
-- "simples" de solo semilla, sin las columnas de auditoría estándar.
ALTER TABLE variedades ADD COLUMN IF NOT EXISTS creado_por UUID REFERENCES usuarios(id);
ALTER TABLE variedades ADD COLUMN IF NOT EXISTS dispositivo_id TEXT;
ALTER TABLE variedades ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE variedades ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE variedades ADD COLUMN IF NOT EXISTS eliminado_at TIMESTAMPTZ;

ALTER TABLE colores_cinta ADD COLUMN IF NOT EXISTS creado_por UUID REFERENCES usuarios(id);
ALTER TABLE colores_cinta ADD COLUMN IF NOT EXISTS dispositivo_id TEXT;
ALTER TABLE colores_cinta ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE colores_cinta ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE colores_cinta ADD COLUMN IF NOT EXISTS eliminado_at TIMESTAMPTZ;

ALTER TABLE configuracion_frecuencias ADD COLUMN IF NOT EXISTS creado_por UUID REFERENCES usuarios(id);
ALTER TABLE configuracion_frecuencias ADD COLUMN IF NOT EXISTS dispositivo_id TEXT;
ALTER TABLE configuracion_frecuencias ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE configuracion_frecuencias ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE configuracion_frecuencias ADD COLUMN IF NOT EXISTS eliminado_at TIMESTAMPTZ;
