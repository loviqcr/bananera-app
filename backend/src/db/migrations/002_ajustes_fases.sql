-- ============================================================================
-- Ajustes descubiertos al implementar las fases 2-9 sobre el núcleo de la
-- Fase 1, más datos de referencia iniciales para que los formularios no
-- arranquen vacíos.
-- ============================================================================

-- El responsable de un equipo (sección 6 del prompt: "Responsable: Juan
-- Pérez") suele ser personal de campo que no necesariamente tiene una
-- cuenta de acceso a la app (esas viven en `usuarios`, ver decisión en
-- docs/analisis-arquitectura-fase1.md). Se agrega un campo de texto libre
-- para el nombre del responsable del equipo, sin tocar `responsable_id`
-- (queda disponible para cuando exista una asignación real a un usuario).
ALTER TABLE equipos ADD COLUMN IF NOT EXISTS responsable_nombre TEXT;

-- Evita variedades duplicadas si esta migración llegara a aplicarse más de
-- una vez en un entorno de desarrollo.
ALTER TABLE variedades ADD CONSTRAINT variedades_nombre_tipo_unico UNIQUE (nombre, tipo);

INSERT INTO variedades (nombre, tipo) VALUES
  ('Cavendish', 'banano'),
  ('Gran Enano', 'banano'),
  ('Curraré', 'platano'),
  ('Cuerno', 'platano'),
  ('Dominico', 'platano')
ON CONFLICT (nombre, tipo) DO NOTHING;

-- Sección 8 del prompt: "Cada finca debe tener su propia bodega" — la
-- migración 001 solo creó la Bodega Principal (3 áreas), sin bodega por
-- finca. Se agregan aquí, una por finca.
INSERT INTO bodegas (id, finca_id, tipo, nombre)
SELECT gen_random_uuid(), f.id, 'finca', 'Bodega ' || f.nombre
FROM fincas f
WHERE NOT EXISTS (
  SELECT 1 FROM bodegas b WHERE b.finca_id = f.id AND b.tipo = 'finca'
);
