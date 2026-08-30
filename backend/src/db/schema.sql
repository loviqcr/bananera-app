-- ============================================================================
-- App Bananera - Esquema completo de base de datos (PostgreSQL)
-- Cubre TODAS las fases (1 a 9). El backend de Fase 1 solo usa las tablas
-- marcadas como [FASE 1]; el resto queda listo para fases futuras sin tener
-- que volver a diseñar el esquema.
--
-- Convenciones aplicadas a toda tabla operativa/sincronizable:
--   id            UUID PRIMARY KEY  (generado en el dispositivo, nunca serial)
--   creado_por    UUID              (usuario que creó el registro)
--   dispositivo_id TEXT             (identifica el dispositivo de origen)
--   created_at    TIMESTAMPTZ
--   updated_at    TIMESTAMPTZ
--   eliminado_at  TIMESTAMPTZ NULL  (borrado lógico, nunca DELETE físico)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Función utilitaria: actualizar updated_at automáticamente
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- NÚCLEO [FASE 1]
-- ============================================================================

CREATE TABLE roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL UNIQUE, -- administrador | encargado_finca | bodega | planilla | trabajador
  descripcion   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permisos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rol_id        UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  modulo        TEXT NOT NULL, -- 'produccion' | 'inventario' | 'bodega' | 'incidencias' | 'labores' | 'planilla' | 'ventas' | 'embolse' | 'corta' | 'reportes' | 'usuarios'
  puede_ver     BOOLEAN NOT NULL DEFAULT false,
  puede_crear   BOOLEAN NOT NULL DEFAULT false,
  puede_editar  BOOLEAN NOT NULL DEFAULT false,
  puede_eliminar BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (rol_id, modulo)
);

CREATE TABLE usuarios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         TEXT NOT NULL,
  usuario        TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  pin_hash       TEXT, -- opcional, para acceso rápido en campo (fase futura)
  rol_id         UUID NOT NULL REFERENCES roles(id),
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);

CREATE TABLE fincas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       TEXT NOT NULL,
  orden        INTEGER NOT NULL,
  creado_por   UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at TIMESTAMPTZ
);

CREATE TABLE areas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finca_id     UUID NOT NULL REFERENCES fincas(id),
  nombre       TEXT NOT NULL,
  orden        INTEGER NOT NULL,
  creado_por   UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at TIMESTAMPTZ
);

CREATE TABLE usuario_fincas (
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  finca_id   UUID NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, finca_id)
);

CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tabla           TEXT NOT NULL,
  registro_id     UUID NOT NULL,
  usuario_id      UUID REFERENCES usuarios(id),
  accion          TEXT NOT NULL, -- 'crear' | 'editar' | 'eliminar' | 'conflicto_resuelto'
  datos_anteriores JSONB,
  datos_nuevos    JSONB,
  fecha           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PRODUCCIÓN [FASE 2]
-- ============================================================================

CREATE TABLE variedades (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         TEXT NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('platano','banano')),
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);

CREATE TABLE entregas_platano (
  id               UUID PRIMARY KEY,
  finca_id         UUID NOT NULL REFERENCES fincas(id),
  area_id          UUID REFERENCES areas(id),
  fecha            DATE NOT NULL,
  cantidad_cajas   NUMERIC(10,2) NOT NULL DEFAULT 0,
  cantidad_dedos   INTEGER NOT NULL DEFAULT 0,
  calidad          TEXT NOT NULL CHECK (calidad IN ('primera','segunda')),
  variedad_id      UUID REFERENCES variedades(id),
  sistema_racimo   TEXT,
  cantidad_racimos INTEGER,
  responsable_id   UUID REFERENCES usuarios(id),
  observaciones    TEXT,
  creado_por       UUID REFERENCES usuarios(id),
  dispositivo_id   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at     TIMESTAMPTZ
);

CREATE TABLE entregas_banano (
  id             UUID PRIMARY KEY,
  finca_id       UUID NOT NULL REFERENCES fincas(id),
  area_id        UUID REFERENCES areas(id),
  fecha          DATE NOT NULL,
  cantidad_cajas NUMERIC(10,2) NOT NULL DEFAULT 0,
  cantidad_manos INTEGER NOT NULL DEFAULT 0,
  calidad        TEXT NOT NULL CHECK (calidad IN ('primera','segunda')),
  variedad_id    UUID REFERENCES variedades(id),
  responsable_id UUID REFERENCES usuarios(id),
  observaciones  TEXT,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);

-- ============================================================================
-- LABORES Y CALENDARIO [FASE 3]
-- ============================================================================

CREATE TABLE configuracion_frecuencias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_labor     TEXT NOT NULL UNIQUE, -- 'deshija' | 'dermaticida' | 'fertilizacion'
  dias           INTEGER NOT NULL,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);

CREATE TABLE labores_siembra (
  id             UUID PRIMARY KEY,
  finca_id       UUID NOT NULL REFERENCES fincas(id),
  area_id        UUID REFERENCES areas(id),
  fecha          DATE NOT NULL,
  nombre         TEXT,
  cantidad       NUMERIC(10,2),
  variedad_id    UUID REFERENCES variedades(id),
  responsable_id UUID REFERENCES usuarios(id),
  observaciones  TEXT,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);

CREATE TABLE labores_deshija (
  id             UUID PRIMARY KEY,
  finca_id       UUID NOT NULL REFERENCES fincas(id),
  area_id        UUID NOT NULL REFERENCES areas(id),
  fecha          DATE NOT NULL,
  proxima_fecha  DATE NOT NULL,
  responsable_id UUID REFERENCES usuarios(id),
  observaciones  TEXT,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);

CREATE TABLE labores_dermaticida (
  id             UUID PRIMARY KEY,
  finca_id       UUID NOT NULL REFERENCES fincas(id),
  area_id        UUID NOT NULL REFERENCES areas(id),
  fecha          DATE NOT NULL,
  producto       TEXT NOT NULL,
  cantidad       NUMERIC(10,2),
  unidad         TEXT,
  proxima_fecha  DATE NOT NULL,
  responsable_id UUID REFERENCES usuarios(id),
  observaciones  TEXT,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);

CREATE TABLE labores_fertilizacion (
  id             UUID PRIMARY KEY,
  finca_id       UUID NOT NULL REFERENCES fincas(id),
  area_id        UUID NOT NULL REFERENCES areas(id),
  fecha          DATE NOT NULL,
  formula        TEXT NOT NULL,
  cantidad       NUMERIC(10,2),
  unidad         TEXT,
  proxima_fecha  DATE NOT NULL,
  responsable_id UUID REFERENCES usuarios(id),
  observaciones  TEXT,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);

-- ============================================================================
-- INVENTARIO Y EQUIPOS [FASE 4]
-- ============================================================================

CREATE TABLE insumos (
  id              UUID PRIMARY KEY,
  finca_id        UUID NOT NULL REFERENCES fincas(id),
  nombre          TEXT NOT NULL,
  categoria       TEXT NOT NULL, -- fertilizantes | herbicidas | fungicidas | herramientas | repuestos | materiales | otros
  unidad          TEXT NOT NULL,
  cantidad_minima NUMERIC(10,2) NOT NULL DEFAULT 0,
  creado_por      UUID REFERENCES usuarios(id),
  dispositivo_id  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at    TIMESTAMPTZ
);

CREATE TABLE movimientos_insumo (
  id             UUID PRIMARY KEY,
  insumo_id      UUID NOT NULL REFERENCES insumos(id),
  tipo           TEXT NOT NULL CHECK (tipo IN ('entrada','salida','ajuste')),
  cantidad       NUMERIC(10,2) NOT NULL,
  motivo         TEXT,
  responsable_id UUID REFERENCES usuarios(id),
  fecha          DATE NOT NULL,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);

CREATE TABLE equipos (
  id                 UUID PRIMARY KEY,
  codigo             TEXT NOT NULL,
  nombre             TEXT NOT NULL,
  tipo               TEXT NOT NULL CHECK (tipo IN ('bomba','motobomba','dosificadora','herbicida','foliar','herramienta','otro')),
  finca_id           UUID NOT NULL REFERENCES fincas(id),
  responsable_id     UUID REFERENCES usuarios(id),
  estado             TEXT NOT NULL DEFAULT 'operativa' CHECK (estado IN ('operativa','mantenimiento','danada','fuera_de_servicio')),
  fecha_registro     DATE NOT NULL DEFAULT current_date,
  fecha_mantenimiento DATE,
  observaciones      TEXT,
  creado_por         UUID REFERENCES usuarios(id),
  dispositivo_id     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX equipos_codigo_activo_key ON equipos (codigo) WHERE eliminado_at IS NULL;

-- ============================================================================
-- BODEGAS [FASE 4]
-- ============================================================================

CREATE TABLE bodegas (
  id           UUID PRIMARY KEY,
  finca_id     UUID REFERENCES fincas(id), -- NULL cuando tipo = 'principal'
  tipo         TEXT NOT NULL CHECK (tipo IN ('finca','principal')),
  nombre       TEXT NOT NULL,
  creado_por   UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at TIMESTAMPTZ
);

CREATE TABLE bodega_items (
  id         UUID PRIMARY KEY,
  bodega_id  UUID NOT NULL REFERENCES bodegas(id),
  producto   TEXT NOT NULL,
  categoria  TEXT NOT NULL,
  unidad     TEXT NOT NULL,
  creado_por UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at TIMESTAMPTZ
);

CREATE TABLE movimientos_bodega (
  id                UUID PRIMARY KEY,
  bodega_item_id    UUID NOT NULL REFERENCES bodega_items(id),
  tipo              TEXT NOT NULL CHECK (tipo IN ('entrada','salida','ajuste','transferencia')),
  cantidad          NUMERIC(10,2) NOT NULL,
  bodega_origen_id  UUID REFERENCES bodegas(id),
  bodega_destino_id UUID REFERENCES bodegas(id),
  responsable_id    UUID REFERENCES usuarios(id),
  fecha             DATE NOT NULL,
  creado_por        UUID REFERENCES usuarios(id),
  dispositivo_id    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at      TIMESTAMPTZ
);

-- ============================================================================
-- INCIDENCIAS Y NOTIFICACIONES [FASE 5]
-- ============================================================================

CREATE TABLE incidencias (
  id             UUID PRIMARY KEY,
  finca_id       UUID NOT NULL REFERENCES fincas(id),
  area_id        UUID REFERENCES areas(id),
  fecha          DATE NOT NULL,
  hora           TIME,
  tipo           TEXT NOT NULL CHECK (tipo IN ('equipo','cultivo','riego','bodega','personal','electricidad','mantenimiento','otro')),
  descripcion    TEXT NOT NULL,
  foto_url       TEXT,
  responsable_id UUID REFERENCES usuarios(id),
  prioridad      TEXT NOT NULL CHECK (prioridad IN ('urgente','alta','media','baja')),
  estado         TEXT NOT NULL DEFAULT 'reportada' CHECK (estado IN ('reportada','asignada','en_proceso','resuelta','cerrada')),
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);

CREATE TABLE notificaciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id        UUID REFERENCES usuarios(id), -- NULL = para todos los que apliquen por rol/finca
  tipo              TEXT NOT NULL, -- 'inventario_bajo' | 'labor_proxima' | 'labor_atrasada' | 'incidencia_urgente'
  titulo            TEXT NOT NULL,
  mensaje           TEXT NOT NULL,
  referencia_tabla  TEXT,
  referencia_id     UUID,
  leida             BOOLEAN NOT NULL DEFAULT false,
  fecha             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PLANILLA [FASE 6]
-- ============================================================================

CREATE TABLE empleados (
  id             UUID PRIMARY KEY,
  finca_id       UUID NOT NULL REFERENCES fincas(id),
  area_id        UUID REFERENCES areas(id),
  codigo         TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  puesto         TEXT,
  estado         TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo')),
  fecha_ingreso  DATE,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX empleados_codigo_activo_key ON empleados (codigo) WHERE eliminado_at IS NULL;

CREATE TABLE asistencia (
  id            UUID PRIMARY KEY,
  empleado_id   UUID NOT NULL REFERENCES empleados(id),
  fecha         DATE NOT NULL,
  estado        TEXT NOT NULL CHECK (estado IN ('presente','ausente','incapacidad','permiso','vacaciones')),
  observaciones TEXT,
  creado_por    UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at  TIMESTAMPTZ,
  UNIQUE (empleado_id, fecha)
);

-- ============================================================================
-- VENTAS [FASE 7]
-- ============================================================================

CREATE TABLE clientes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         TEXT NOT NULL,
  contacto       TEXT,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);

CREATE TABLE ventas_platano (
  id               UUID PRIMARY KEY,
  finca_id         UUID NOT NULL REFERENCES fincas(id),
  fecha            DATE NOT NULL,
  variedad_id      UUID REFERENCES variedades(id),
  cantidad_dedos   INTEGER NOT NULL,
  precio_por_dedo  NUMERIC(10,4) NOT NULL,
  cliente_id       UUID REFERENCES clientes(id),
  responsable_id   UUID REFERENCES usuarios(id),
  observaciones    TEXT,
  creado_por       UUID REFERENCES usuarios(id),
  dispositivo_id   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at     TIMESTAMPTZ
);

CREATE TABLE ventas_banano (
  id               UUID PRIMARY KEY,
  finca_id         UUID NOT NULL REFERENCES fincas(id),
  fecha            DATE NOT NULL,
  variedad_id      UUID REFERENCES variedades(id),
  cantidad_manos   INTEGER NOT NULL,
  precio_por_mano  NUMERIC(10,4) NOT NULL,
  cliente_id       UUID REFERENCES clientes(id),
  responsable_id   UUID REFERENCES usuarios(id),
  observaciones    TEXT,
  creado_por       UUID REFERENCES usuarios(id),
  dispositivo_id   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at     TIMESTAMPTZ
);

-- ============================================================================
-- EMBOLSE Y CORTA [FASE 8]
-- ============================================================================

CREATE TABLE colores_cinta (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         TEXT NOT NULL UNIQUE,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);

CREATE TABLE embolse (
  id             UUID PRIMARY KEY,
  finca_id       UUID NOT NULL REFERENCES fincas(id),
  area_id        UUID REFERENCES areas(id),
  fecha          DATE NOT NULL,
  cantidad       INTEGER NOT NULL,
  color_cinta_id UUID REFERENCES colores_cinta(id),
  responsable_id UUID REFERENCES usuarios(id),
  observaciones  TEXT,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);

CREATE TABLE corta (
  id                UUID PRIMARY KEY,
  finca_id          UUID NOT NULL REFERENCES fincas(id),
  area_id           UUID REFERENCES areas(id),
  fecha             DATE NOT NULL,
  racimos_cortados  INTEGER NOT NULL,
  responsable_id    UUID REFERENCES usuarios(id),
  observaciones     TEXT,
  creado_por        UUID REFERENCES usuarios(id),
  dispositivo_id    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at      TIMESTAMPTZ
);

-- ============================================================================
-- ÍNDICES (filtrado por finca/área es el patrón de consulta más frecuente)
-- ============================================================================

CREATE INDEX idx_areas_finca ON areas(finca_id);
CREATE INDEX idx_entregas_platano_finca_fecha ON entregas_platano(finca_id, fecha);
CREATE INDEX idx_entregas_banano_finca_fecha ON entregas_banano(finca_id, fecha);
CREATE INDEX idx_incidencias_finca_estado ON incidencias(finca_id, estado);
CREATE INDEX idx_asistencia_empleado_fecha ON asistencia(empleado_id, fecha);
CREATE INDEX idx_ventas_platano_finca_fecha ON ventas_platano(finca_id, fecha);
CREATE INDEX idx_ventas_banano_finca_fecha ON ventas_banano(finca_id, fecha);
CREATE INDEX idx_corta_finca_fecha ON corta(finca_id, fecha);
CREATE INDEX idx_movimientos_insumo_insumo ON movimientos_insumo(insumo_id);
CREATE INDEX idx_movimientos_bodega_item ON movimientos_bodega(bodega_item_id);
CREATE INDEX idx_audit_logs_tabla_registro ON audit_logs(tabla, registro_id);
CREATE INDEX idx_notificaciones_usuario_leida ON notificaciones(usuario_id, leida);

-- ============================================================================
-- TRIGGERS updated_at (núcleo Fase 1; se agregan más a medida que se activan
-- los módulos de fases siguientes)
-- ============================================================================

CREATE TRIGGER trg_usuarios_updated_at BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_fincas_updated_at BEFORE UPDATE ON fincas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_areas_updated_at BEFORE UPDATE ON areas FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- SEED: roles, permisos base, las 4 fincas, frecuencias de labores, bodega
-- principal (3 áreas), colores de cinta, usuario administrador inicial
-- ============================================================================

INSERT INTO roles (id, nombre, descripcion) VALUES
  ('00000000-0000-0000-0000-000000000001', 'administrador', 'Acceso completo a las 4 fincas'),
  ('00000000-0000-0000-0000-000000000002', 'encargado_finca', 'Administra la información de su finca'),
  ('00000000-0000-0000-0000-000000000003', 'bodega', 'Administra inventario y bodegas'),
  ('00000000-0000-0000-0000-000000000004', 'planilla', 'Administra trabajadores y asistencia'),
  ('00000000-0000-0000-0000-000000000005', 'trabajador', 'Registra producción, labores e incidencias');

INSERT INTO fincas (id, nombre, orden) VALUES
  ('00000000-0000-0000-0001-000000000001', 'Finca 1', 1),
  ('00000000-0000-0000-0001-000000000002', 'Finca 2', 2),
  ('00000000-0000-0000-0001-000000000003', 'Finca 3', 3),
  ('00000000-0000-0000-0001-000000000004', 'Finca 4', 4);

INSERT INTO bodegas (id, finca_id, tipo, nombre) VALUES
  ('00000000-0000-0000-0002-000000000001', NULL, 'principal', 'Bodega Principal Área 1'),
  ('00000000-0000-0000-0002-000000000002', NULL, 'principal', 'Bodega Principal Área 2'),
  ('00000000-0000-0000-0002-000000000003', NULL, 'principal', 'Bodega Principal Área 3');

INSERT INTO configuracion_frecuencias (tipo_labor, dias) VALUES
  ('deshija', 45),
  ('dermaticida', 120),
  ('fertilizacion', 22);

INSERT INTO colores_cinta (nombre) VALUES
  ('Rojo'), ('Azul'), ('Verde'), ('Amarillo'), ('Blanco');

-- Permisos por defecto (módulo x rol). puede_ver/crear/editar/eliminar.
INSERT INTO permisos (rol_id, modulo, puede_ver, puede_crear, puede_editar, puede_eliminar)
SELECT r.id, m.modulo, true, true, true, (r.nombre = 'administrador')
FROM roles r
CROSS JOIN (VALUES
  ('produccion'), ('inventario'), ('bodega'), ('incidencias'), ('labores'),
  ('planilla'), ('ventas'), ('embolse'), ('corta'), ('reportes'), ('usuarios')
) AS m(modulo)
WHERE r.nombre = 'administrador';

-- encargado_finca: todo menos usuarios
INSERT INTO permisos (rol_id, modulo, puede_ver, puede_crear, puede_editar, puede_eliminar)
SELECT r.id, m.modulo, true, true, true, false
FROM roles r
CROSS JOIN (VALUES
  ('produccion'), ('inventario'), ('bodega'), ('incidencias'), ('labores'),
  ('planilla'), ('embolse'), ('corta'), ('reportes')
) AS m(modulo)
WHERE r.nombre = 'encargado_finca';

-- bodega: inventario y bodega
INSERT INTO permisos (rol_id, modulo, puede_ver, puede_crear, puede_editar, puede_eliminar)
SELECT r.id, m.modulo, true, true, true, false
FROM roles r
CROSS JOIN (VALUES ('inventario'), ('bodega')) AS m(modulo)
WHERE r.nombre = 'bodega';

-- planilla: planilla
INSERT INTO permisos (rol_id, modulo, puede_ver, puede_crear, puede_editar, puede_eliminar)
SELECT r.id, m.modulo, true, true, true, false
FROM roles r
CROSS JOIN (VALUES ('planilla')) AS m(modulo)
WHERE r.nombre = 'planilla';

-- trabajador: registrar produccion, labores, incidencias (sin editar/eliminar)
INSERT INTO permisos (rol_id, modulo, puede_ver, puede_crear, puede_editar, puede_eliminar)
SELECT r.id, m.modulo, true, true, false, false
FROM roles r
CROSS JOIN (VALUES ('produccion'), ('labores'), ('incidencias'), ('embolse'), ('corta')) AS m(modulo)
WHERE r.nombre = 'trabajador';

-- El usuario administrador inicial NO se crea aquí (para no dejar un hash
-- de contraseña fijo en el repositorio). Lo crea `npm run seed` en el
-- backend, que genera un hash bcrypt real a partir de las variables de
-- entorno ADMIN_USUARIO / ADMIN_PASSWORD.
