-- Tarifa diaria por trabajador, para el cálculo de pago (bruto, sin
-- rebajos). Se separa de "empleados" a propósito: encargado_finca puede
-- leer empleados (para pasar lista), pero el salario es información más
-- sensible y solo debe llegar a administrador/planilla (ver rolesLectura
-- en syncRegistry.ts) — si viviera como columna de empleados, cualquier
-- rol con acceso de lectura a esa tabla también recibiría el salario al
-- sincronizar, sin importar qué pantalla se le oculte en la UI.
CREATE TABLE salarios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id    UUID NOT NULL UNIQUE REFERENCES empleados(id) ON DELETE CASCADE,
  salario_diario NUMERIC(12,2) NOT NULL,
  creado_por     UUID REFERENCES usuarios(id),
  dispositivo_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  eliminado_at   TIMESTAMPTZ
);
