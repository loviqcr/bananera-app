/**
 * Registro central de tablas sincronizables. Cada módulo de una fase futura
 * (producción, inventario, incidencias, labores, ventas, embolse, corta...)
 * se conecta al motor de sincronización agregando UNA entrada aquí — no hace
 * falta tocar routes/sync.routes.ts ni el cliente de sincronización de la
 * PWA, que ya son genéricos.
 *
 * conflictStrategy:
 *  - 'lww'          : gana el registro con updated_at más reciente
 *                      (last-write-wins). Correcto para todo lo que es una
 *                      "ficha" editable (fincas, áreas, equipos...).
 *  - 'append_only'   : nunca hay conflicto real porque cada dispositivo solo
 *                      agrega filas nuevas (entregas, ventas, labores,
 *                      incidencias, embolse, corta). No se permite editar
 *                      por sync, solo crear.
 *  - 'kardex'        : movimientos de inventario/bodega — nunca se
 *                      sobreescribe una "cantidad actual", solo se insertan
 *                      movimientos; dos movimientos concurrentes se suman.
 */
export interface TablaSincronizable {
  tabla: string;
  columnas: string[]; // columnas editables además de las de control
  fincaScoped: boolean; // la tabla tiene columna finca_id directa
  permiteEliminar: boolean;
  conflictStrategy: 'lww' | 'append_only' | 'kardex';
  rolesEscritura: string[]; // roles que pueden empujar cambios de esta tabla
}

export const REGISTRO_SYNC: Record<string, TablaSincronizable> = {
  fincas: {
    tabla: 'fincas',
    columnas: ['nombre', 'orden'],
    fincaScoped: false,
    permiteEliminar: false,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador'],
  },
  areas: {
    tabla: 'areas',
    columnas: ['finca_id', 'nombre', 'orden'],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca'],
  },
  // Fases futuras agregan aquí sus entradas, por ejemplo:
  // entregas_platano: { tabla: 'entregas_platano', columnas: [...], fincaScoped: true,
  //   permiteEliminar: false, conflictStrategy: 'append_only', rolesEscritura: [...] },
};
