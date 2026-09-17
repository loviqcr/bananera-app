-- Rediseño de "Pasar lista" (Mano de Obra): además del estado, ahora se
-- registran las horas trabajadas ese día, para que el Cálculo de pago
-- pueda prorratear un día parcial (ej. 3h de una jornada de 8h) en vez de
-- pagar el día completo siempre que hay "presente". Nula por defecto: los
-- registros históricos que no la tienen se siguen tratando como jornada
-- completa (8h) en el cálculo, sin necesidad de rellenar nada hacia atrás.
ALTER TABLE asistencia ADD COLUMN IF NOT EXISTS horas NUMERIC(4,2);
