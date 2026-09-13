-- Suscripciones de notificaciones push (Web Push / VAPID) por usuario y
-- dispositivo/navegador. Un mismo usuario puede tener varias filas (celular +
-- computadora, por ejemplo) — cada endpoint es único porque lo asigna el
-- navegador al suscribirse.
CREATE TABLE push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subscriptions_usuario ON push_subscriptions(usuario_id);
