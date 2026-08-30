# App Bananera — Análisis, Arquitectura y Diseño de Base de Datos (Fase 1)

Última actualización: 2026-08-30
Este documento consolida el prompt completo de requisitos, la especificación
original (`especificacion-app-bananera.md`, 2026-08-16) y el plan técnico de
sincronización (`plan-tecnico-fase2-sincronizacion.md`, 2026-08-20), y deja
fijadas las decisiones necesarias para empezar a construir.

## 0. Decisiones confirmadas con el usuario

| Decisión | Resultado |
|---|---|
| Tecnología base | **Evolucionar el PWA actual** (HTML/CSS/JS + IndexedDB), no reescribir en Flutter. Se prioriza reutilizar el trabajo offline ya probado. |
| Dónde se construye | En el espacio de trabajo en la nube de Claude; el código se entrega como archivos/zip por fase, no se conecta una carpeta local. |
| Alcance de esta entrega | Este documento **+** la implementación funcional de Fase 1 (arquitectura, base de datos, login, usuarios, fincas, áreas, offline-first, sincronización). |

Nota importante: el zip original `bananera-app.zip` (el PWA "prototipo funcional"
mencionado en la especificación) no está disponible en este espacio de trabajo
— solo su documentación. Por lo tanto, el código de Fase 1 se **reconstruye
desde cero siguiendo fielmente la especificación documentada** (mismos
módulos, mismos campos, mismo comportamiento offline), en vez de editar el
zip original. Si Jafet conserva ese zip, puede adjuntarlo y se puede
comparar/fusionar campo por campo antes de la Fase 2; mientras tanto esta
base es funcionalmente equivalente y queda mejor estructurada para crecer.

## 1. Análisis de requisitos e inconsistencias detectadas

El prompt de 30 secciones es, en esencia, una versión ampliada de lo que ya
se había especificado y planeado. Antes de programar, estas son las
diferencias e inconsistencias que hay que resolver:

1. **Nomenclatura de base de datos (español vs inglés).** El prompt nuevo
   sugiere nombres de tabla en inglés (`users`, `farms`, `areas`...) como
   lista mínima orientativa, mientras que el plan técnico ya escrito usa
   español (`fincas`, `entregas_platano`...) porque así lo pidió Jafet
   originalmente. **Decisión: se mantiene español**, consistente con el
   trabajo ya aprobado y con el idioma en que el equipo de campo va a leer
   los datos si algún día se expone un reporte crudo. Este documento incluye
   una tabla de equivalencia por si se integra con sistemas externos en
   inglés más adelante.
2. **Rol "Trabajador".** El plan técnico de Fase 2 solo definía 4 roles
   (Administrador, Encargado de finca, Bodega, Planilla). El prompt nuevo
   agrega un quinto rol, **Trabajador**, que registra producción, labores e
   incidencias pero no administra inventario/planilla. Se incorpora como rol
   real con permisos acotados (sección 8).
3. **Login: PIN vs usuario/contraseña.** El plan técnico de Fase 2 dejaba
   esto como pregunta abierta ("¿login por dispositivo compartido o PIN
   individual?"). El prompt nuevo (sección 19) no pide PIN explícitamente,
   solo roles y permisos configurables. **Decisión: usuario + contraseña con
   JWT para Fase 1** (más simple de asegurar y auditar desde el día uno);
   se deja el modelo de datos preparado para agregar PIN de acceso rápido en
   campo como mejora de Fase 6-9 sin romper nada, porque la tabla
   `usuarios` ya incluye una columna `pin_hash` opcional desde ahora.
4. **Dashboard y reportes con exportación (PDF/Excel/CSV).** Son
   requisitos nuevos que no estaban en los documentos previos. No se pierden:
   quedan ubicados en Fase 2 (dashboard) y Fase 7/9 (reportes y exportación),
   tal como el propio plan de fases del prompt los ordena.
5. **Notificaciones push reales.** El prompt pide notificaciones (inventario
   bajo, labor próxima, incidencia urgente, labor atrasada). En Fase 1 se
   deja lista la tabla `notificaciones` y la lógica de servidor que las
   genera (triggers/consultas), pero el **envío push al dispositivo** (Web
   Push) se implementa en Fase 5, cuando ya exista el módulo de incidencias
   y labores que las disparan — antes de eso no hay nada que notificar.
6. **"Sistema de racimo, cantidad" (Plátano) y "Dermaticida".** Siguen
   siendo supuestos heredados del documento original, aún sin confirmar por
   Jafet: se interpretan como dos campos separados (tipo de sistema +
   cantidad de racimos) y como aplicación de producto fitosanitario por
   área, respectivamente. Se mantienen así salvo que Jafet indique lo
   contrario.
7. **Bodega principal con 3 áreas.** El prompt la describe como bodega
   aparte con 3 áreas propias (no como una quinta "finca"). Así se modela:
   `bodegas` es una entidad independiente de `fincas`, con `tipo` = principal
   o de finca, evitando forzar una "Finca 5" ficticia en el selector de
   fincas que el usuario pidió limitar a 4 + "Todas".
8. **Kárdex de inventario/bodega.** Confirmado y mantenido del plan técnico:
   en vez de guardar "cantidad actual" como número editable (que choca si
   dos dispositivos ajustan sin internet a la vez), se guardan movimientos
   (entrada/salida/ajuste/transferencia) y la cantidad es la suma. Esto
   resuelve de raíz el único punto de conflicto real de sincronización que
   tiene la app.

Ninguna funcionalidad pedida se eliminó; donde hubo que tomar una decisión
técnica se documentó arriba con su razón, tal como se pidió en la sección 30
del prompt.

## 2. Arquitectura general

```
┌─────────────────────────┐
│   PWA (móvil/tablet/PC)  │  HTML + CSS + JS, instalable ("Agregar a inicio")
│  ┌────────────────────┐ │
│  │ UI (fincas/áreas/   │ │
│  │ módulos)            │ │
│  ├────────────────────┤ │
│  │ IndexedDB (local)   │◄┼── toda escritura pasa primero por aquí, siempre
│  │  + sync_queue       │ │
│  ├────────────────────┤ │
│  │ Service Worker      │ │  cachea el shell de la app (funciona sin red)
│  │ Sync Client         │ │  detecta conexión, empuja/hala en segundo plano
│  └─────────┬──────────┘ │
└────────────┼─────────────┘
             │ HTTPS (solo cuando hay internet)
             ▼
┌─────────────────────────┐
│   API REST (Node.js +    │  Express + TypeScript
│   TypeScript)             │  Auth JWT, control de roles, validación
│  ┌────────────────────┐ │
│  │ /auth  /sync        │ │
│  │ /fincas /areas ...  │ │
│  │ Audit log            │ │
│  └─────────┬──────────┘ │
└────────────┼─────────────┘
             ▼
┌─────────────────────────┐
│   PostgreSQL              │  fuente de verdad central, 1 base para las 4 fincas
└─────────────────────────┘
```

Principio rector (offline-first real, no "offline como excepción"): **ninguna
pantalla espera respuesta del servidor para guardar**. Todo formulario
escribe en IndexedDB de inmediato, se le asigna un UUID generado en el propio
dispositivo, y se encola en `sync_queue`. El Sync Client es el único que
habla con el backend, y lo hace en segundo plano.

## 3. Tecnologías

| Capa | Tecnología | Por qué |
|---|---|---|
| Frontend | PWA — HTML5, CSS3, JavaScript (ES modules), sin framework pesado | Reutiliza el prototipo ya validado por el equipo de campo; instala en Android desde Chrome sin Play Store; un único código sirve para celular, tablet y PC. Se evalúo agregar un framework (React/Vue) pero no aporta beneficio real a este tamaño de app y sí más complejidad de build. |
| Almacenamiento local | IndexedDB vía una capa propia ligera (`localdb.js`) | Nativo del navegador, sin dependencias externas, soporta consultas por índice necesarias para filtrar por finca/área sin conexión. |
| Service Worker | Cache API | Deja instalar la app y que cargue el "shell" (HTML/CSS/JS) sin red. |
| Backend | Node.js + TypeScript + Express | Tal como sugirió Jafet; tipado fuerte reduce errores en un dominio con muchos campos numéricos y fechas de recordatorio. |
| Base de datos | PostgreSQL | Relacional, soporta bien reportes agregados (ventas por mes, rendimiento por finca) y UUID nativo. |
| Autenticación | JWT (access token corto + refresh token) | El dispositivo puede seguir usando el último token válido para firmar registros creados sin internet; al reconectar, renueva. |
| Migraciones | SQL versionado simple (`db/migrations`), aplicado por un runner propio de ~40 líneas (`db/migrate.ts`) que registra en `schema_migrations` qué ya se aplicó | Evita la "magia" y las dependencias extra de un migrador de terceros; el equipo puede leer el SQL real tal cual se ejecuta. |
| Hosting sugerido | Render, Railway o Fly.io (Node + Postgres gestionado) | Igual que en el plan de Fase 2: HTTPS gestionado, sin administrar servidor propio. |

## 4. Sistema offline-first y sincronización

Reglas fijas para **todos** los módulos futuros, no solo Fase 1:

1. Cada registro creado en cualquier dispositivo lleva un **UUID generado en
   el dispositivo** (nunca autoincremental) — así dos dispositivos nunca
   pueden crear el "mismo id" por accidente.
2. Columnas de control en toda tabla sincronizable: `id`, `creado_por`
   (usuario), `dispositivo_id`, `created_at`, `updated_at`, `eliminado_at`
   (borrado lógico — nunca se borra físicamente un registro sincronizado).
3. Al guardar, el registro se escribe en IndexedDB **y** se agrega una
   entrada a `sync_queue` local con `{tabla, operacion, id, payload,
   intentos, ultimo_error}`.
4. El Sync Client corre en segundo plano (evento `online`/`offline` del
   navegador + reintento periódico): si hay conexión, envía la cola al
   backend en lotes (`POST /sync/push`), y por cada item aceptado lo marca
   como sincronizado y lo saca de la cola. Si un item falla, se reintenta
   con backoff sin bloquear los demás.
5. En sentido contrario, el dispositivo hace `GET /sync/pull?desde=<última
   marca>` por finca/alcance del usuario, y aplica los cambios localmente
   (crea o actualiza según `updated_at`).
6. **Resolución de conflictos:**
   - Módulos de solo-agregar (entregas, ventas, labores, embolse, corte,
     incidencias): no compiten por el mismo registro → no hay conflicto real.
   - Inventario/bodega: modelo de **movimientos** (kárdex), no de "cantidad
     actual" editable, así que dos ajustes offline en dos dispositivos se
     suman en vez de pisarse.
   - Cualquier otro caso de edición del mismo registro: gana el
     `updated_at` más reciente (last-write-wins) y el anterior queda en
     `audit_logs` para trazabilidad, nunca se pierde silenciosamente.
7. **Indicadores de estado**, visibles siempre en la barra superior:
   🟢 Sincronizado · 🟡 N pendientes · 🔴 Error de sincronización ·
   📴 Sin conexión — con el texto "Sin conexión — los datos se guardarán en
   el dispositivo y se sincronizarán automáticamente cuando vuelva Internet."
8. **Login offline:** tras el primer login en línea, el dispositivo guarda
   el token JWT y los datos del usuario en IndexedDB, y permite reabrir
   sesión sin internet mientras el token no haya expirado (validación local
   de expiración); todo registro creado en ese estado queda igual marcado
   con `creado_por` y se valida contra el servidor cuando sincroniza.

## 5. Roles y permisos

| Rol | Alcance | Puede |
|---|---|---|
| Administrador | Las 4 fincas + bodega principal | Todo, incluyendo usuarios, roles y configuración (frecuencias de labores, mínimos de inventario) |
| Encargado de finca | Su(s) finca(s) asignada(s) | Entregas, inventario, bodega, incidencias, labores, embolse, corte, planilla de su finca |
| Bodega | Inventario/bombas/bodegas (todas las fincas o la asignada) | Movimientos de bodega, responsables de equipo, mínimos de inventario |
| Planilla | Su(s) finca(s) asignada(s) | Empleados y asistencia diaria |
| Trabajador | Su finca/área asignada | Registrar producción, labores e incidencias (sin ver costos/ventas ni administrar inventario) |

Los permisos se guardan en tablas `roles` y `permisos` (no hardcodeados en
código) para poder ajustarse desde administración sin desplegar de nuevo,
tal como pide la sección 19 del prompt.

## 6. Estructura de carpetas

```
bananera-app/
├── backend/
│   ├── src/
│   │   ├── config/        # env, conexión a la base
│   │   ├── db/
│   │   │   ├── schema.sql         # esquema completo (todas las fases)
│   │   │   └── migrations/        # migraciones versionadas
│   │   ├── middleware/    # auth (JWT), roles, manejo de errores
│   │   ├── routes/        # auth, fincas, areas, sync, (futuras: produccion, ...)
│   │   ├── services/      # lógica de sincronización, auditoría
│   │   ├── utils/
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── index.html
│   ├── manifest.json
│   ├── service-worker.js
│   ├── css/estilos.css
│   └── js/
│       ├── db/localdb.js       # capa IndexedDB genérica + sync_queue
│       ├── sync/syncClient.js  # push/pull en segundo plano
│       ├── modules/auth.js
│       ├── modules/fincas.js
│       ├── modules/estadoConexion.js
│       └── app.js
└── docs/
    └── analisis-arquitectura-fase1.md   (este documento)
```

Los módulos de fases futuras (producción, inventario, bodega, incidencias,
labores, planilla, ventas, embolse, corte, reportes) se agregan cada uno como
su propio archivo en `frontend/js/modules/` y su propio archivo de rutas en
`backend/src/routes/`, reutilizando siempre la misma capa `localdb.js` /
`syncClient.js` — por eso Fase 1 invierte esfuerzo en dejar esa capa genérica
y bien probada.

## 7. Diseño de base de datos (completo, todas las fases)

Convenciones aplicadas a **toda** tabla operativa (se omiten abajo por
brevedad, pero están en `schema.sql`): `id UUID PRIMARY KEY`, `creado_por
UUID`, `dispositivo_id TEXT`, `created_at`, `updated_at`, `eliminado_at`.

### Núcleo (Fase 1 — implementado ahora)
- `roles(id, nombre, descripcion)`
- `permisos(id, rol_id, modulo, puede_ver, puede_crear, puede_editar, puede_eliminar)`
- `usuarios(id, nombre, usuario, password_hash, pin_hash NULL, rol_id, activo)`
- `usuario_fincas(usuario_id, finca_id)` — asignación de alcance por finca
- `fincas(id, nombre, orden)` — exactamente 4 filas, nombre editable
- `areas(id, finca_id, nombre, orden)`
- `sync_queue` (solo local en el dispositivo, no vive en Postgres)
- `audit_logs(id, tabla, registro_id, usuario_id, accion, datos_anteriores, datos_nuevos, fecha)`

### Producción (Fase 2)
- `variedades(id, nombre, tipo['platano'|'banano'])`
- `entregas_platano(id, finca_id, area_id, fecha, cantidad_cajas, cantidad_dedos, calidad, variedad_id, sistema_racimo, cantidad_racimos, responsable_id, observaciones)`
- `entregas_banano(id, finca_id, area_id, fecha, cantidad_cajas, cantidad_manos, calidad, variedad_id, responsable_id, observaciones)`

### Labores y calendario (Fase 3)
- `labores_siembra(id, finca_id, area_id, fecha, nombre, cantidad, variedad_id, responsable_id, observaciones)`
- `labores_deshija(id, finca_id, area_id, fecha, proxima_fecha, responsable_id, observaciones)`
- `labores_dermaticida(id, finca_id, area_id, fecha, producto, cantidad, unidad, proxima_fecha, responsable_id, observaciones)`
- `labores_fertilizacion(id, finca_id, area_id, fecha, formula, cantidad, unidad, proxima_fecha, responsable_id, observaciones)`
- `configuracion_frecuencias(id, tipo_labor, dias)` — deshija=45, dermaticida=120, fertilización=22 (editable desde administración)

### Inventario y equipos (Fase 4)
- `insumos(id, finca_id, nombre, categoria, unidad, cantidad_minima)`
- `movimientos_insumo(id, insumo_id, tipo['entrada'|'salida'|'ajuste'], cantidad, motivo, responsable_id, fecha)` — cantidad actual = suma de movimientos
- `equipos(id, codigo, nombre, tipo['bomba'|'motobomba'|'dosificadora'|'herbicida'|'foliar'|'herramienta'|'otro'], finca_id, responsable_id, estado['operativa'|'mantenimiento'|'danada'|'fuera_de_servicio'], fecha_registro, fecha_mantenimiento, observaciones)`

### Bodegas (Fase 4)
- `bodegas(id, finca_id NULL, tipo['finca'|'principal'], nombre)` — bodega principal = 3 filas con `finca_id = NULL` y `tipo='principal'`
- `bodega_items(id, bodega_id, producto, categoria, unidad)`
- `movimientos_bodega(id, bodega_item_id, tipo['entrada'|'salida'|'ajuste'|'transferencia'], cantidad, bodega_origen_id, bodega_destino_id, responsable_id, fecha)`

### Incidencias (Fase 5)
- `incidencias(id, finca_id, area_id, fecha, hora, tipo, descripcion, foto_url, responsable_id, prioridad, estado)`
- `notificaciones(id, usuario_id NULL, tipo, titulo, mensaje, referencia_tabla, referencia_id, leida, fecha)`

### Planilla (Fase 6)
- `empleados(id, finca_id, area_id, codigo, nombre, puesto, estado['activo'|'inactivo'], fecha_ingreso)`
- `asistencia(id, empleado_id, fecha, estado['presente'|'ausente'|'incapacidad'|'permiso'|'vacaciones'], observaciones)`

### Ventas (Fase 7)
- `clientes(id, nombre, contacto)`
- `ventas_platano(id, finca_id, fecha, variedad_id, cantidad_dedos, precio_por_dedo, cliente_id, responsable_id, observaciones)` — `total` calculado
- `ventas_banano(id, finca_id, fecha, variedad_id, cantidad_manos, precio_por_mano, cliente_id, responsable_id, observaciones)` — `total` calculado

### Embolse y corta (Fase 8)
- `colores_cinta(id, nombre, activo)` — configurable
- `embolse(id, finca_id, area_id, fecha, cantidad, color_cinta_id, responsable_id, observaciones)`
- `corta(id, finca_id, area_id, fecha, racimos_cortados, responsable_id, observaciones)`

### Reportes/auditoría (Fase 9)
- Los reportes (producción, ventas, rendimiento, etc.) son **vistas SQL
  agregadas** sobre las tablas de arriba, no tablas nuevas — igual que ya
  proponía el plan técnico de Fase 2 para ventas y corte.
- `audit_logs` (ya creada en el núcleo) cubre "quién creó/modificó qué".

El archivo `backend/src/db/schema.sql` entregado en esta fase incluye **las
tablas completas de todos los módulos** (para que el diseño de base de datos
quede cerrado desde ahora, como pidió Jafet), aunque el backend y la PWA de
esta entrega solo exponen y usan las del núcleo (Fase 1). Cada fase futura
agrega sus rutas/pantallas sin tener que tocar el esquema.

## 8. Plan de fases

Se confirma el orden de fases propuesto por Jafet (sección 29 del prompt),
sin cambios:

1. Arquitectura, base de datos, login, usuarios, fincas, áreas, offline-first, sincronización — **implementado en esta entrega**
2. Dashboard, producción (plátano/banano)
3. Labores (siembra, deshija, dermaticida, fertilización) + calendario
4. Inventario, equipos, bodegas, bodega principal
5. Incidencias, notificaciones
6. Planilla, asistencia
7. Ventas, reportes
8. Embolse, corta, rendimiento
9. Dashboard avanzado, estadísticas, exportación PDF/Excel, auditoría, optimización

## 9. Verificación realizada en esta entrega

No se entregó como "prototipo vacío": antes de empaquetar se verificó con
un backend y una base de datos reales (PostgreSQL local):

- `npm run typecheck` del backend sin errores.
- `npm run migrate` aplicó `schema.sql` completo sobre PostgreSQL limpio sin
  fallos (incluye las tablas de las 9 fases, no solo el núcleo).
- `npm run seed` creó el usuario administrador con contraseña cifrada
  (bcrypt).
- Pruebas manuales contra el servidor real: login correcto/incorrecto,
  listado de fincas, creación de un área vía `/sync/push`, **reenvío del
  mismo lote para confirmar que no duplica** (mismo UUID → sin efecto la
  segunda vez), un intento de editar con una fecha vieja para confirmar que
  **last-write-wins rechaza correctamente** el dato desactualizado, y
  verificación de que `audit_logs` quedó con el historial completo.
- Control de roles probado en vivo: un usuario con rol `trabajador` recibe
  403 al intentar administrar usuarios o renombrar una finca, pero sí puede
  listar fincas (200).
- **Prueba de punta a punta con navegador real (Playwright)**: iniciar
  sesión → elegir Finca 1 → **desconectar la red del dispositivo** → crear
  un área nueva estando sin conexión → confirmar que aparece de inmediato
  en la pantalla (guardado local) → **recargar la app siguiendo sin
  conexión** → confirmar que la finca activa y el área creada se
  mantienen (persistencia real en IndexedDB, no en memoria) → reconectar →
  confirmar que el indicador pasa a 🟢 Sincronizado → confirmar en el
  servidor que existe **exactamente una** fila con esos datos (no
  duplicada). Los 12 pasos de esta prueba pasaron.
- Capturas de pantalla del login, el selector de finca y el shell de
  inicio, en modo claro y oscuro, para confirmar que el diseño responde al
  estilo pedido (tarjetas, botones grandes, colores agrícolas modernos).

## 10. Qué queda funcionando después de esta entrega

- Backend Node/TS/Express corriendo con PostgreSQL, con el esquema completo
  migrado.
- Login con usuario/contraseña, JWT, roles y alcance por finca.
- CRUD de fincas (las 4, nombre editable) y áreas.
- Motor de sincronización genérico (`sync_queue`, push/pull, control de
  conflictos) ya funcional y reutilizable por todos los módulos futuros —
  esta es la pieza más importante de esta fase porque todo lo demás se
  construye encima sin volver a tocarla.
- PWA instalable con selector de finca/área persistente, botón "Cambiar
  finca", indicadores de estado de sincronización, y guardado 100% offline
  verificado (crear un registro sin internet, cerrar la app, reabrir,
  reconectar, confirmar que sincroniza sin duplicar).

## 11. Adenda — Fases 2 a 9 (implementación completa)

Última actualización: 2026-08-30. Tras la Fase 1, Jafet pidió avanzar el
proyecto completo (todas las fases) en la misma entrega. Esta sección deja
registradas las decisiones nuevas y, sobre todo, los errores reales que
apareció la verificación de punta a punta — no solo revisión de código — y
cómo se corrigieron, siguiendo el mismo estándar de "no prototipo vacío" de
la Fase 1.

### 11.1 Decisiones de diseño de las fases 2-9

- **`append_only` reconsiderado a `lww` casi en todas partes.** El plan
  original de sincronización proponía "solo agregar" (sin edición) para
  entregas, labores, incidencias, ventas, embolse y corta. En la práctica
  de campo, un capataz necesita poder corregir una entrega mal digitada
  (cantidad, calidad, área) sin crear un registro duplicado ni pedirle a un
  administrador que edite la base de datos a mano. Se cambió esa estrategia
  a `lww` (last-write-wins) para todas esas tablas — solo `movimientos_insumo`
  y `movimientos_bodega` (el kárdex de inventario/bodega) se mantienen
  estrictamente de solo-agregar, porque un movimiento de inventario nunca
  debe "corregirse" retroactivamente — se compensa con un movimiento nuevo.
- **`equipos.responsable_nombre` en vez de un selector de usuarios.** La
  especificación pide un responsable con nombre y apellido, pero muchos
  responsables de campo no tienen (ni necesitan) usuario en el sistema, y
  los roles no-administradores no pueden consultar `/usuarios` para llenar
  un selector. Se agregó una columna de texto libre (migración 002) en vez
  de forzar una relación con `usuarios`.
- **Notificaciones calculadas en el cliente, no un backend de push real.**
  Confirmado en el análisis de Fase 1 y mantenido: `alertas.js` combina
  inventario bajo, labores atrasadas/próximas e incidencias urgentes ya
  sincronizadas en IndexedDB, sin necesitar infraestructura de push (FCM,
  web push) que no formaba parte del alcance aprobado.
- **Exportación de reportes**: CSV con Blob nativo, Excel con SheetJS
  (cargado desde cdnjs), PDF con `window.print()` y una hoja de estilos
  `@media print` dedicada — sin backend de generación de PDF, evita una
  dependencia pesada del lado del servidor para un requisito que el
  navegador ya resuelve bien.
- **Auditoría (`audit_logs`) no se sincroniza a los dispositivos.** Se
  consulta bajo demanda vía `GET /auditoria` (solo administrador), en línea,
  con filtros — descargar todo el historial de cambios a cada celular de
  campo no tiene sentido y crecería sin límite.
- **`movimientos_insumo` y `movimientos_bodega` no están acotados por
  finca (`fincaScoped: false`) a nivel de motor de sincronización.** El
  acceso real se controla porque el `insumo_id`/`bodega_item_id` al que
  apuntan sí pertenece a una finca — queda documentado como limitación
  conocida: un usuario con acceso a una sola finca puede en teoría enviar
  un movimiento para un `insumo_id` de otra finca si lo adivina. No se
  explotó en las pruebas porque la UI nunca ofrece ids ajenos, pero es un
  endurecimiento pendiente si se requiere blindaje contra manipulación
  directa de la API (fuera del alcance normal de la app de campo).

### 11.2 Errores reales encontrados y corregidos en la verificación

La verificación de Fase 1 ya había establecido el estándar de probar contra
Postgres real y navegador real en vez de solo leer el código. Aplicar el
mismo estándar a las fases 2-9 encontró tres fallas reales que una simple
revisión de código no hubiera detectado, las tres con corrección aplicada y
reverificada:

1. **`/sync/pull` completamente roto para todo dispositivo.** Las tablas
   `clientes`, `variedades`, `colores_cinta` y `configuracion_frecuencias`
   quedaron registradas en el motor de sincronización (`REGISTRO_SYNC`)
   pero su definición en `schema.sql` nunca recibió las columnas de
   auditoría estándar (`creado_por`, `dispositivo_id`, `created_at`,
   `updated_at`, `eliminado_at`) que el motor asume para *cualquier* tabla
   registrada. Como `obtenerCambiosPendientes` hace `ORDER BY updated_at`
   sobre cada tabla registrada sin excepción, **todo** `GET /sync/pull`
   fallaba con error 500 — no solo para esas tablas, para el dispositivo
   completo — desde el momento en que se agregaron esas cuatro tablas al
   registro. Se corrigió con la migración `003_clientes_columnas_sync.sql`
   (agrega las columnas faltantes a las cuatro tablas) y se reverificó que
   `/sync/pull` devuelve las 25 tablas correctamente.
2. **Toda edición parcial sobre una tabla con alcance de finca se
   rechazaba.** `repos.editar()` del cliente manda solo los campos que
   cambiaron (no la fila completa), pero el backend exigía que el payload
   incluyera `finca_id` para validar el acceso, cosa que un diff parcial
   normalmente no trae. Además, el camino de escritura para `lww` usaba
   `INSERT ... ON CONFLICT DO UPDATE`, y Postgres evalúa las restricciones
   `NOT NULL` de la fila candidata del INSERT *antes* de llegar a resolver
   el conflicto — así que aunque se resolviera lo de `finca_id`, cualquier
   edición parcial que no repitiera columnas `NOT NULL` sin default (por
   ejemplo, cambiar solo el `estado` de un equipo, sin repetir `codigo`/
   `nombre`/`tipo`) igual hubiera fallado. Esto afectaba **cualquier**
   edición sobre **cualquier** tabla — el cambio de estado de un equipo, la
   actualización de estado de una incidencia, y cualquier corrección futura
   sobre datos ya sincronizados. Se corrigió en dos partes: (a) si el
   payload de una edición no trae `finca_id`, el servidor busca la
   `finca_id` de la fila existente para validar el acceso; (b) se separó el
   camino de edición de tablas `lww` a un `UPDATE` real que solo toca las
   columnas presentes en el diff, en vez de reutilizar el `INSERT ... ON
   CONFLICT` pensado para altas completas. Reverificado con una edición
   vieja (debe perder contra LWW), una edición nueva (debe ganar) y una
   edición parcial de un solo campo (debe conservar el resto de la fila
   intacto) — los tres casos pasaron.
3. **Los cálculos de "hoy" quedaban en cero después de sincronizar.** El
   driver `pg` devuelve las columnas `DATE` como objetos `Date` de
   JavaScript, que al serializarse a JSON se convierten en un timestamp
   completo (`"2026-08-30T00:00:00.000Z"`) en vez de la fecha simple
   (`"2026-08-30"`) que el dispositivo generó al crear el registro. Como
   varios módulos comparan fechas por igualdad exacta de texto
   (`fila.fecha === hoyISO()` en las tarjetas "hoy" del dashboard, en
   `laboresConEstado`, en el calendario, y en el upsert por llave natural
   de asistencia), cualquier dato que ya hubiera pasado por el servidor
   dejaba de coincidir con la fecha de "hoy" generada localmente — las
   tarjetas de producción del día mostraban 0 aunque sí había entregas
   registradas hoy. Se corrigió con un solo cambio en el pool de conexión
   (`types.setTypeParser` para el OID 1082 de Postgres), forzando que toda
   columna `DATE` viaje siempre como texto plano `YYYY-MM-DD` sin pasar por
   el constructor `Date` — corrige el problema de raíz para cualquier
   columna de fecha, actual o futura, sin tocar cada módulo por separado.
   Reverificado en el navegador: tras la corrección, "Dedos de plátano hoy"
   y "Manos de banano hoy" mostraron los valores reales en vez de 0.

### 11.3 Verificación realizada para las fases 2-9

- `npm run typecheck` sin errores después de cada corrección.
- Migraciones 002 y 003 aplicadas sobre PostgreSQL real y reverificadas con
  consultas directas (bodegas por finca, variedades sembradas, columna
  `responsable_nombre`, columnas de auditoría en las cuatro tablas de
  catálogo).
- Backend real levantado (`npm run dev`) y probado con lotes de
  `/sync/push` que cubren las 25 tablas sincronizables: producción
  (plátano/banano), labores con frecuencia auto-calculada, insumos +
  kárdex, equipos, bodegas + transferencia entre bodega de finca y bodega
  principal (verificado matemáticamente: origen −5, destino +5, ambos
  kárdex independientes), incidencias, empleados + asistencia, clientes +
  ventas, embolse y corta — las 25 tablas devolvieron `estado: 'ok'` tras
  las correcciones.
- Casos de conflicto probados explícitamente contra el servidor real: LWW
  con edición vieja (rechazada) y nueva (aceptada), edición parcial de un
  campo sin perder el resto de la fila, upsert por llave natural de
  asistencia (dos UUIDs de dispositivos distintos para el mismo
  empleado+fecha convergen en una sola fila), y rechazo controlado de un
  código de equipo duplicado (`23505` → `'rechazado'`, no un error que
  reintente para siempre).
- **Prueba de punta a punta con navegador real (Playwright)**: login →
  selector "todas las fincas" (dashboard consolidado sin colgarse) →
  cambio a Finca 1 → los 10 módulos nuevos (Producción, Labores,
  Calendario, Inventario, Incidencias, Planilla, Ventas, Embolse/Corta,
  Reportes, Notificaciones) abren sin mensajes de error → flujo funcional
  completo de registrar una entrega de plátano (aparece en la lista de
  inmediato) → registrar un insumo y confirmar que la alerta de inventario
  bajo aparece → reportar una incidencia urgente y confirmar que sube el
  contador de "Incidencias pendientes" del dashboard → abrir Reportes y
  confirmar que los botones de exportación (CSV/Excel/PDF) están
  presentes y el filtro funciona. Capturas de pantalla guardadas para
  revisión visual de cada módulo.
- Verificación cruzada de cada módulo de campos contra el `schema.sql` real
  (no contra lo que el módulo "debería" tener) para los nueve módulos de
  negocio — se encontraron y corrigieron los tres problemas de la sección
  11.2 precisamente por hacer esta verificación contra el servidor real en
  vez de solo revisar el código.

### 11.4 Qué queda pendiente / fuera de alcance

- Blindaje adicional de `movimientos_insumo`/`movimientos_bodega` contra un
  `insumo_id`/`bodega_item_id` de otra finca enviado directamente a la API
  (no a través de la UI) — ver nota en 11.1.
- Notificaciones push reales (fuera de alcance aprobado; el cálculo
  client-side cubre el requisito funcional).
- PIN de acceso rápido en campo (la columna `pin_hash` sigue lista desde
  Fase 1, sin usarse todavía).
