-- Permite dejar escrita la solución/respuesta al atender una incidencia
-- (ej. "se mandaron bolsas nuevas el 14/10"), sin tener que adivinarlo
-- después solo por el cambio de estado a "Resuelta".
ALTER TABLE incidencias ADD COLUMN respuesta TEXT;
