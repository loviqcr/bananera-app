-- "Entrega de Carga": pantalla rápida de conteo de cajas por responsable
-- (con +/- en vez de escribir números) para cuando se está cargando el
-- camión. Reutiliza entregas_platano a propósito (se pidió que sume a los
-- mismos reportes/dashboard de Producción, no un conteo aparte) — solo se
-- le agregan dos columnas nuevas, nulas por defecto, que no afectan ningún
-- registro ni reporte existente:
--   - responsable_nombre: quién cargó, de una lista de nombres fijos que
--     administra quien usa esta pantalla (no son usuarios del sistema con
--     login, por eso texto libre en vez de responsable_id → usuarios).
--   - grupo_entrega: agrupa las 1-2 filas (una por calidad) que se crean
--     en un solo toque de "Guardar entrega", para poder mostrarlas juntas
--     en el resumen "Hoy" sin mezclarlas con las demás entregas del día de
--     esa misma persona.
ALTER TABLE entregas_platano ADD COLUMN IF NOT EXISTS responsable_nombre TEXT;
ALTER TABLE entregas_platano ADD COLUMN IF NOT EXISTS grupo_entrega UUID;

CREATE TABLE responsables_carga (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         TEXT NOT NULL,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ,
  UNIQUE (nombre)
);
