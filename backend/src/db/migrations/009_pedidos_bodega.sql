-- "Pedidos a bodega": los capataces/encargados de cada finca escriben en
-- texto libre lo que necesitan (bolsas, cintas, mecate, herramientas...) y
-- le llega un aviso push al administrador, en vez de mandarlo por el grupo
-- de WhatsApp. Es texto libre a propósito (no una lista de productos): lo que
-- se pide cambia cada semana y una lista cerrada estorbaría.
CREATE TABLE pedidos_bodega (
  id                UUID PRIMARY KEY,
  finca_id          UUID NOT NULL REFERENCES fincas(id),
  fecha             DATE NOT NULL,
  texto             TEXT NOT NULL,
  solicitante_id    UUID REFERENCES usuarios(id),
  solicitante_nombre TEXT,
  estado            TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','entregado')),
  creado_por        UUID REFERENCES usuarios(id),
  dispositivo_id    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at      TIMESTAMPTZ
);

CREATE INDEX idx_pedidos_bodega_finca ON pedidos_bodega(finca_id);
