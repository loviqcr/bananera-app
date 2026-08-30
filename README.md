# App Bananera — Fase 1

Gestión operativa de 4 fincas bananeras, offline-first. Esta entrega cubre la
**Fase 1**: arquitectura, base de datos, login, usuarios, fincas, áreas,
guardado sin internet y sincronización.

Lee primero `docs/analisis-arquitectura-fase1.md` — ahí está el análisis
completo, las decisiones tomadas, la arquitectura y el diseño de base de
datos de las 9 fases.

## Estructura

```
backend/    API REST — Node.js + TypeScript + Express + PostgreSQL
frontend/   PWA — HTML + CSS + JavaScript + IndexedDB (instalable en Android/iOS/PC)
docs/       Documento de análisis y arquitectura
```

## 1. Levantar el backend

Requiere Node.js 18+ y una base PostgreSQL (local o en Render/Railway/Fly.io).

```bash
cd backend
npm install
cp .env.example .env      # editar DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET
npm run migrate            # crea todas las tablas (schema completo, 9 fases)
npm run seed                # crea el usuario administrador (ADMIN_USUARIO/ADMIN_PASSWORD de .env)
npm run dev                 # arranca en http://localhost:3000
```

Verificar que quedó arriba: `curl http://localhost:3000/health` debe
responder `{"estado":"ok","base_de_datos":"conectada"}`.

**Importante:** cambia `JWT_SECRET`, `JWT_REFRESH_SECRET` y
`ADMIN_PASSWORD` antes de usar esto con datos reales — los valores de
`.env.example` son solo para desarrollo.

## 2. Abrir la PWA

La carpeta `frontend/` es estática — no necesita build ni Node para
funcionar, solo servirla por HTTP (los navegadores no permiten IndexedDB ni
Service Workers correctamente desde `file://`).

Para probarla en este equipo:

```bash
cd frontend
python3 -m http.server 8080
```

Y abrir `http://localhost:8080` — con el backend corriendo en el puerto
3000, el login por defecto ya apunta ahí (`js/config.js`).

Para publicarla de verdad (Netlify, Vercel, GitHub Pages, o el propio
backend sirviéndola como estático), sube el contenido de `frontend/` tal
cual, y antes de eso:

1. Edita `frontend/js/config.js` y cambia `API_BASE_URL` por la URL pública
   de tu backend ya desplegado (o define `window.BANANERA_API_URL` en un
   `<script>` antes de cargar `app.js`, para no tocar el código fuente en
   cada despliegue).
2. Publícala con HTTPS (Netlify/Vercel/GitHub Pages lo dan automático) — los
   Service Workers y algunas APIs que usa (como `crypto.randomUUID`) lo
   requieren fuera de `localhost`.
3. En el teléfono, abrir la URL en Chrome y usar "Agregar a pantalla de
   inicio" para instalarla como app.

## 3. Primer ingreso

Usuario y contraseña son los que definiste en `ADMIN_USUARIO` /
`ADMIN_PASSWORD` del `.env` del backend antes de correr `npm run seed`
(por defecto en `.env.example`: `admin` / `cambiar123` — cámbialos).

Al entrar, la app pide elegir una finca (las 4 ya vienen creadas por el
script de migración) y luego un área. Un administrador o encargado de finca
puede agregar áreas nuevas desde el botón "+ Agregar área" — funciona con o
sin conexión.

## 4. Cómo se prueba el modo offline

1. Con la app abierta y con sesión iniciada, desconecta el WiFi/datos del
   dispositivo (o en Chrome de escritorio: DevTools → Network → Offline).
2. Verás el aviso "📴 Sin conexión — los datos se guardarán en el
   dispositivo...".
3. Agrega un área (o cualquier registro de los módulos que se vayan
   agregando en las próximas fases): se guarda al instante.
4. Cierra la pestaña/app y vuelve a abrirla siguiendo sin conexión: el
   registro sigue ahí (está en IndexedDB, no en memoria).
5. Reconecta: el indicador pasa de 🟡 a 🟢 automáticamente en unos segundos
   y el registro queda en el servidor — sin duplicarse aunque reintentes.

Esto ya se verificó de punta a punta con una prueba automatizada (ver
sección 9 de `docs/analisis-arquitectura-fase1.md`).

## Próximas fases

El orden confirmado con Jafet (sección 8 del documento de arquitectura):
Fase 2 dashboard/producción, Fase 3 labores/calendario, Fase 4
inventario/bodegas, Fase 5 incidencias/notificaciones, Fase 6
planilla/asistencia, Fase 7 ventas/reportes, Fase 8 embolse/corta, Fase 9
dashboard avanzado/exportación/auditoría.

Cada fase se agrega sin rediseñar lo ya construido: nuevas rutas en
`backend/src/routes/`, una entrada nueva en
`backend/src/services/syncRegistry.ts`, y un módulo nuevo en
`frontend/js/modules/` que reutiliza `localdb.js` y `syncClient.js` tal
como están.
