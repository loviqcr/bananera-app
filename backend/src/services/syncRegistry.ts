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
  /**
   * Roles que pueden descargar (pull) esta tabla. Por defecto (sin definir)
   * cualquier rol autenticado la recibe — correcto para catálogos/datos
   * operativos que todos los roles necesitan para navegar la app (fincas,
   * áreas, variedades...). Se define explícito solo para datos sensibles que
   * no todo rol debería ver aunque no los escriba (nómina, precios de venta).
   */
  rolesLectura?: string[];
  /**
   * Columnas que identifican de forma única la fila para efectos de
   * ON CONFLICT. Por defecto ['id']. Se usa distinto de ['id'] cuando la
   * tabla tiene además una llave natural (ej. asistencia: un empleado no
   * puede tener dos registros para el mismo día aunque dos dispositivos
   * hayan generado UUIDs distintos sin conexión) — así dos registros
   * creados offline para "lo mismo" convergen en una sola fila al
   * sincronizar, en vez de duplicarse.
   */
  conflictColumns?: string[];
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

  // -------------------------------------------------------------------
  // NOTA de diseño (fases 2-8): el documento de arquitectura original
  // proponía 'append_only' para entregas/ventas/labores/embolse/corta
  // razonando que nunca compiten por el mismo registro. Se mantiene esa
  // razón (por eso no hace falta un merge de campos complejo), pero se
  // usa 'lww' en vez de 'append_only' para que quien capturó el dato
  // pueda corregir un error de digitación después — algo que en campo
  // pasa todo el tiempo y que 'append_only' bloquearía por completo. El
  // riesgo de conflicto real sigue siendo casi nulo porque normalmente
  // solo el creador edita su propio registro.
  // -------------------------------------------------------------------

  // ---- Fase 2: Producción ----
  variedades: {
    tabla: 'variedades',
    columnas: ['nombre', 'tipo'],
    fincaScoped: false,
    permiteEliminar: false,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca'],
  },
  entregas_platano: {
    tabla: 'entregas_platano',
    columnas: [
      'finca_id', 'area_id', 'fecha', 'cantidad_cajas', 'cantidad_dedos', 'calidad',
      'variedad_id', 'sistema_racimo', 'cantidad_racimos', 'responsable_id', 'observaciones',
    ],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'trabajador'],
  },
  entregas_banano: {
    tabla: 'entregas_banano',
    columnas: [
      'finca_id', 'area_id', 'fecha', 'cantidad_cajas', 'cantidad_manos', 'calidad',
      'variedad_id', 'responsable_id', 'observaciones',
    ],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'trabajador'],
  },

  // ---- Fase 3: Labores y calendario ----
  configuracion_frecuencias: {
    tabla: 'configuracion_frecuencias',
    columnas: ['tipo_labor', 'dias'],
    fincaScoped: false,
    permiteEliminar: false,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador'],
    conflictColumns: ['tipo_labor'],
  },
  labores_siembra: {
    tabla: 'labores_siembra',
    columnas: ['finca_id', 'area_id', 'fecha', 'nombre', 'cantidad', 'variedad_id', 'responsable_id', 'observaciones'],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'trabajador'],
  },
  labores_deshija: {
    tabla: 'labores_deshija',
    columnas: ['finca_id', 'area_id', 'fecha', 'proxima_fecha', 'responsable_id', 'observaciones'],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'trabajador'],
  },
  labores_dermaticida: {
    tabla: 'labores_dermaticida',
    columnas: ['finca_id', 'area_id', 'fecha', 'producto', 'cantidad', 'unidad', 'proxima_fecha', 'responsable_id', 'observaciones'],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'trabajador'],
  },
  labores_fertilizacion: {
    tabla: 'labores_fertilizacion',
    columnas: ['finca_id', 'area_id', 'fecha', 'formula', 'cantidad', 'unidad', 'proxima_fecha', 'responsable_id', 'observaciones'],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'trabajador'],
  },

  // ---- Fase 4: Inventario, equipos y bodegas ----
  insumos: {
    tabla: 'insumos',
    columnas: ['finca_id', 'nombre', 'categoria', 'unidad', 'cantidad_minima'],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'bodega'],
  },
  movimientos_insumo: {
    // Sin finca_id propio (se deriva de insumo_id → insumos.finca_id); el
    // control de acceso por finca para este kárdex queda a nivel de UI
    // (solo se listan insumos de la finca activa) — ver limitaciones
    // conocidas en el documento de arquitectura.
    tabla: 'movimientos_insumo',
    columnas: ['insumo_id', 'tipo', 'cantidad', 'motivo', 'responsable_id', 'fecha'],
    fincaScoped: false,
    permiteEliminar: false,
    conflictStrategy: 'kardex',
    rolesEscritura: ['administrador', 'encargado_finca', 'bodega'],
  },
  equipos: {
    tabla: 'equipos',
    columnas: ['codigo', 'nombre', 'tipo', 'finca_id', 'responsable_nombre', 'estado', 'fecha_registro', 'fecha_mantenimiento', 'observaciones'],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'bodega'],
  },
  bodegas: {
    tabla: 'bodegas',
    columnas: ['finca_id', 'tipo', 'nombre'],
    fincaScoped: false, // incluye la bodega principal, que no pertenece a ninguna finca
    permiteEliminar: false,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador'],
  },
  bodega_items: {
    tabla: 'bodega_items',
    columnas: ['bodega_id', 'producto', 'categoria', 'unidad'],
    fincaScoped: false,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'bodega'],
  },
  movimientos_bodega: {
    tabla: 'movimientos_bodega',
    columnas: ['bodega_item_id', 'tipo', 'cantidad', 'bodega_origen_id', 'bodega_destino_id', 'responsable_id', 'fecha'],
    fincaScoped: false,
    permiteEliminar: false,
    conflictStrategy: 'kardex',
    rolesEscritura: ['administrador', 'encargado_finca', 'bodega'],
  },

  // ---- Fase 5: Incidencias ----
  incidencias: {
    tabla: 'incidencias',
    columnas: ['finca_id', 'area_id', 'fecha', 'hora', 'tipo', 'descripcion', 'foto_url', 'responsable_id', 'prioridad', 'estado'],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'trabajador'],
  },

  // ---- Fase 6: Planilla ----
  empleados: {
    tabla: 'empleados',
    columnas: ['finca_id', 'area_id', 'codigo', 'nombre', 'puesto', 'estado', 'fecha_ingreso'],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'planilla'],
    rolesLectura: ['administrador', 'encargado_finca', 'planilla'],
  },
  asistencia: {
    tabla: 'asistencia',
    columnas: ['empleado_id', 'fecha', 'estado', 'observaciones'],
    fincaScoped: false,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'planilla'],
    rolesLectura: ['administrador', 'encargado_finca', 'planilla'],
    conflictColumns: ['empleado_id', 'fecha'],
  },

  // ---- Fase 7: Ventas ----
  clientes: {
    tabla: 'clientes',
    columnas: ['nombre', 'contacto'],
    fincaScoped: false,
    permiteEliminar: false,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca'],
    rolesLectura: ['administrador', 'encargado_finca'],
  },
  ventas_platano: {
    tabla: 'ventas_platano',
    columnas: ['finca_id', 'fecha', 'variedad_id', 'cantidad_dedos', 'precio_por_dedo', 'cliente_id', 'responsable_id', 'observaciones'],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca'],
    rolesLectura: ['administrador', 'encargado_finca'],
  },
  ventas_banano: {
    tabla: 'ventas_banano',
    columnas: ['finca_id', 'fecha', 'variedad_id', 'cantidad_manos', 'precio_por_mano', 'cliente_id', 'responsable_id', 'observaciones'],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca'],
    rolesLectura: ['administrador', 'encargado_finca'],
  },

  // ---- Fase 8: Embolse y corta ----
  colores_cinta: {
    tabla: 'colores_cinta',
    columnas: ['nombre', 'activo'],
    fincaScoped: false,
    permiteEliminar: false,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador'],
    conflictColumns: ['nombre'],
  },
  embolse: {
    tabla: 'embolse',
    columnas: ['finca_id', 'area_id', 'fecha', 'cantidad', 'color_cinta_id', 'responsable_id', 'observaciones'],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'trabajador'],
  },
  corta: {
    tabla: 'corta',
    columnas: ['finca_id', 'area_id', 'fecha', 'racimos_cortados', 'responsable_id', 'observaciones'],
    fincaScoped: true,
    permiteEliminar: true,
    conflictStrategy: 'lww',
    rolesEscritura: ['administrador', 'encargado_finca', 'trabajador'],
  },

  // 'notificaciones' y 'audit_logs' se dejan fuera a propósito: las alertas
  // se calculan en el dispositivo a partir de los datos ya sincronizados
  // (funcionan offline sin depender de un push del servidor — ver Fase 5
  // en el documento de arquitectura), y la auditoría se consulta bajo
  // demanda por un endpoint propio de solo lectura para administradores,
  // no se descarga completa a cada dispositivo.
};
