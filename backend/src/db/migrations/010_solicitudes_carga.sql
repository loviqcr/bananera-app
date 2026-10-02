-- "Pedir Carga/Empaque": plantilla rápida para dos pedidos frecuentes del
-- capataz hacia el administrador:
--   - 'carga': reportar cuántas cajas van para cuál comprador (ej. "100
--     cajas para Cenada"), para que el administrador lo verifique y se lo
--     reenvíe al comprador por WhatsApp con un toque.
--   - 'empaque': pedir cajas/material de empaque para la finca (no lleva
--     comprador, es un pedido interno).
-- destinatario es texto suelto (no referencia), igual que
-- entregas_platano.responsable_nombre, para poder reutilizar el mismo
-- catálogo responsables_carga sin acoplar las tablas.
CREATE TABLE solicitudes_carga (
  id                  UUID PRIMARY KEY,
  finca_id            UUID NOT NULL REFERENCES fincas(id),
  fecha               DATE NOT NULL,
  tipo                TEXT NOT NULL CHECK (tipo IN ('carga','empaque')),
  cantidad_cajas      NUMERIC NOT NULL DEFAULT 0,
  destinatario        TEXT,
  observaciones       TEXT,
  solicitante_id      UUID REFERENCES usuarios(id),
  solicitante_nombre  TEXT,
  estado              TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','atendido')),
  creado_por          UUID REFERENCES usuarios(id),
  dispositivo_id      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at        TIMESTAMPTZ
);

CREATE INDEX idx_solicitudes_carga_finca ON solicitudes_carga(finca_id);
