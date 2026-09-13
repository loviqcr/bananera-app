import { localdb, obtenerIdDispositivo } from './db/localdb.js';
import { auth } from './modules/auth.js';
import { fincas } from './modules/fincas.js';
import { iniciarIndicadorConexion } from './modules/estadoConexion.js';
import { iniciarSyncClient, sincronizarAhora } from './sync/syncClient.js';
import { renderizarDashboard, estadisticasDeFinca } from './modules/dashboard.js';
import { incidenciasUrgentesPendientes } from './modules/incidencias.js';
import { hayFormularioSinGuardar, hidratarIconos, tarjetaStat, elemento, mostrarToast } from './ui.js';
import { API_BASE_URL } from './config.js';
import { produccionModulo } from './modules/produccion.js';
import { laboresModulo } from './modules/labores.js';
import { calendarioModulo } from './modules/calendario.js';
import { inventarioModulo } from './modules/inventario.js';
import { incidenciasModulo } from './modules/incidencias.js';
import { planillaModulo } from './modules/planilla.js';
import { ventasModulo } from './modules/ventas.js';
import { embolseCortaModulo } from './modules/embolseCorta.js';
import { reportesModulo } from './modules/reportes.js';
import { alertasModulo } from './modules/alertas.js';
import { usuariosModulo } from './modules/usuarios.js';

const ICONOS_FINCA = ['🌄', '🌴', '🌾', '⛰️'];

function formatearMoneda(valor) {
  return `₡${Number(valor || 0).toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const MODULOS = {
  produccion: produccionModulo,
  labores: laboresModulo,
  calendario: calendarioModulo,
  inventario: inventarioModulo,
  incidencias: incidenciasModulo,
  planilla: planillaModulo,
  ventas: ventasModulo,
  'embolse-corta': embolseCortaModulo,
  reportes: reportesModulo,
  notificaciones: alertasModulo,
  usuarios: usuariosModulo,
};

const vistas = {
  login: document.getElementById('vista-login'),
  selectorFinca: document.getElementById('vista-selector-finca'),
  selectorArea: document.getElementById('vista-selector-area'),
  fincaDetalle: document.getElementById('vista-finca-detalle'),
  inicio: document.getElementById('vista-inicio'),
  mas: document.getElementById('vista-mas'),
  modulo: document.getElementById('vista-modulo'),
};

// A qué botón de la navegación inferior corresponde cada vista — 'modulo' se
// resuelve aparte porque solo Reportes tiene un acceso directo en la barra.
const NAV_POR_VISTA = { inicio: 'inicio', selectorFinca: 'fincas', fincaDetalle: 'fincas', mas: 'mas' };

const el = {
  formLogin: document.getElementById('form-login'),
  campoUsuario: document.getElementById('campo-usuario'),
  campoPassword: document.getElementById('campo-password'),
  errorLogin: document.getElementById('error-login'),
  cuadriculaFincas: document.getElementById('cuadricula-fincas'),
  campoBuscarFinca: document.getElementById('campo-buscar-finca'),
  subtituloSelectorFinca: document.getElementById('subtitulo-selector-finca'),
  listaAreas: document.getElementById('lista-areas'),
  nombreFincaSeleccionArea: document.getElementById('nombre-finca-seleccion-area'),
  botonAgregarArea: document.getElementById('boton-agregar-area'),
  contexto: document.getElementById('barra-contexto'),
  botonSyncAhora: document.getElementById('boton-sync-ahora'),
  bienvenidaUsuario: document.getElementById('bienvenida-usuario'),
  contextoInicio: document.getElementById('contexto-inicio'),
  contenedorDashboard: document.getElementById('contenedor-dashboard'),
  cuadriculaModulos: document.getElementById('cuadricula-modulos'),
  botonCambiarFincaMas: document.getElementById('boton-cambiar-finca-mas'),
  botonSalirMas: document.getElementById('boton-salir-mas'),
  selectorTema: document.getElementById('selector-tema'),
  botonNotificaciones: document.getElementById('boton-notificaciones'),
  botonVolverInicio: document.getElementById('boton-volver-inicio'),
  tituloModulo: document.getElementById('titulo-modulo'),
  contenedorModulo: document.getElementById('contenedor-modulo'),
  navInferior: document.getElementById('nav-inferior'),
  botonRegistrar: document.getElementById('boton-registrar'),
  hojaRegistrar: document.getElementById('hoja-registrar'),
  botonVolverFincas: document.getElementById('boton-volver-fincas'),
  fincaDetalleNombre: document.getElementById('finca-detalle-nombre'),
  fincaDetalleSubtitulo: document.getElementById('finca-detalle-subtitulo'),
  fincaDetalleStats: document.getElementById('finca-detalle-stats'),
  fincaDetalleEstado: document.getElementById('finca-detalle-estado'),
  botonEntrarFinca: document.getElementById('boton-entrar-finca'),
};

let cacheUsuario = null;
let cacheFincas = [];
let vistaActual = 'login';
let moduloActivoClave = null;
let fincaDetalleActual = null;

function mostrarVista(nombre) {
  vistaActual = nombre;
  if (el.hojaRegistrar) el.hojaRegistrar.hidden = true;
  for (const [clave, nodo] of Object.entries(vistas)) {
    if (!nodo) continue;
    nodo.hidden = clave !== nombre;
  }
  if (nombre !== 'modulo') moduloActivoClave = null;

  const sesionActiva = nombre !== 'login';
  document.body.classList.toggle('tiene-nav-inferior', sesionActiva);
  if (el.navInferior) el.navInferior.hidden = !sesionActiva;

  const navActiva = nombre === 'modulo' ? (moduloActivoClave === 'reportes' ? 'reportes' : null) : NAV_POR_VISTA[nombre] ?? null;
  el.navInferior?.querySelectorAll('.nav-inferior__item').forEach((boton) => {
    boton.classList.toggle('nav-inferior__item--activo', boton.dataset.nav === navActiva);
  });
}

function nombreFinca(id) {
  if (id === 'todas') return 'Todas las fincas';
  return cacheFincas.find((f) => f.id === id)?.nombre ?? 'Finca';
}

function contextoActual() {
  return { fincaId: fincas.obtenerFincaActiva(), areaId: fincas.obtenerAreaActiva(), fincaIdsPermitidas: fincasPermitidas() };
}

/**
 * null = sin restricción (administrador/bodega, ven todas las fincas —
 * el backend ya les manda fincaIds: [] por eso). Un array = solo esas
 * fincas, tal como las asignó el administrador en Usuarios.
 */
function fincasPermitidas() {
  return cacheUsuario?.fincaIds?.length ? cacheUsuario.fincaIds : null;
}

async function actualizarContexto() {
  const fincaId = fincas.obtenerFincaActiva();
  const areaId = fincas.obtenerAreaActiva();
  if (!fincaId) {
    el.contexto.textContent = '';
    return;
  }
  let texto = nombreFinca(fincaId);
  if (areaId) {
    const areas = await fincas.listarAreas(fincaId);
    const area = areas.find((a) => a.id === areaId);
    if (area) texto += ` · ${area.nombre}`;
  }
  el.contexto.textContent = texto;
}

// -------------------- Selección de finca --------------------

function detalleFinca(finca) {
  return [
    finca.ubicacion || null,
    finca.hectareas ? `${finca.hectareas} ha` : null,
    finca.plantas ? `${Number(finca.plantas).toLocaleString('es-CR')} plantas` : null,
  ].filter(Boolean).join(' · ');
}

// Síncrona a propósito: se llama en cada tecla del buscador, y si tuviera
// que esperar una consulta async por tarjeta, escribir rápido disparaba
// varias ejecuciones en paralelo que se pisaban entre sí (una limpiaba
// cuadriculaFincas mientras otra todavía estaba agregando tarjetas viejas),
// dejando tarjetas duplicadas o de una búsqueda anterior en pantalla. Por
// eso la urgencia de cada finca se calcula una sola vez en cargarFincas()
// y se guarda en finca.__urgente antes de que el buscador pueda dispararse.
function pintarListaFincas() {
  const termino = (el.campoBuscarFinca?.value || '').trim().toLowerCase();
  const enNavegacion = !!fincas.obtenerFincaActiva();
  el.cuadriculaFincas.innerHTML = '';

  const filtradas = cacheFincas.filter((f) => !termino || f.nombre.toLowerCase().includes(termino));

  for (const finca of filtradas) {
    const indice = cacheFincas.indexOf(finca);
    const envoltorio = document.createElement('div');
    envoltorio.className = 'tarjeta-finca-envoltorio';

    const insignia = finca.__urgente
      ? '<span class="insignia insignia--rojo">🔴 Necesita atención</span>'
      : '<span class="insignia insignia--verde">🟢 Operativa</span>';
    const detalle = detalleFinca(finca);

    const tarjeta = document.createElement('button');
    tarjeta.type = 'button';
    tarjeta.className = 'tarjeta-finca';
    tarjeta.innerHTML = `
      <span class="tarjeta-finca__icono">${ICONOS_FINCA[indice % ICONOS_FINCA.length]}</span>
      <span class="tarjeta-finca__cuerpo">
        <span class="tarjeta-finca__nombre">${finca.nombre}</span>
        ${detalle ? `<span class="tarjeta-finca__detalle">${detalle}</span>` : ''}
        <span class="tarjeta-finca__pie">${insignia}</span>
      </span>
      <span class="tarjeta-finca__chevron" data-icono="chevron"></span>
    `;
    tarjeta.addEventListener('click', () => {
      if (enNavegacion) abrirFincaDetalle(finca);
      else seleccionarFinca(finca.id);
    });
    envoltorio.appendChild(tarjeta);

    if (cacheUsuario?.rol === 'administrador') {
      const botonEditar = document.createElement('button');
      botonEditar.type = 'button';
      botonEditar.className = 'tarjeta-finca__editar';
      botonEditar.title = 'Renombrar finca';
      botonEditar.textContent = '✏️';
      botonEditar.addEventListener('click', async (evento) => {
        evento.stopPropagation();
        const nuevoNombre = prompt('Nuevo nombre de la finca:', finca.nombre);
        if (!nuevoNombre || !nuevoNombre.trim() || nuevoNombre.trim() === finca.nombre) return;
        try {
          await fincas.renombrar(finca.id, nuevoNombre.trim());
          await renderizarSelectorFinca();
        } catch (error) {
          alert(error.message);
        }
      });
      envoltorio.appendChild(botonEditar);
    }

    el.cuadriculaFincas.appendChild(envoltorio);
  }

  if (filtradas.length === 0) {
    el.cuadriculaFincas.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Ninguna finca coincide con la búsqueda.' }));
  }

  // Con una sola finca visible (asignada por el administrador) no tiene
  // sentido ofrecer "Todas las fincas" — es exactamente lo mismo.
  if (!termino && cacheFincas.length > 1) {
    const todas = document.createElement('button');
    todas.type = 'button';
    todas.className = 'boton boton--primario';
    todas.style.marginTop = '4px';
    todas.textContent = '🗂️ Todas las fincas';
    todas.addEventListener('click', () => seleccionarFinca('todas'));
    el.cuadriculaFincas.appendChild(todas);
  }

  hidratarIconos(el.cuadriculaFincas);
  if (el.subtituloSelectorFinca) {
    el.subtituloSelectorFinca.textContent = enNavegacion
      ? 'Aquí puedes ver el estado y detalles de cada finca.'
      : 'Se recordará tu selección — no tendrás que elegirla de nuevo cada vez.';
  }
}

async function renderizarSelectorFinca() {
  const todasLasFincas = await fincas.listar();
  const permitidas = fincasPermitidas();
  cacheFincas = permitidas ? todasLasFincas.filter((f) => permitidas.includes(f.id)) : todasLasFincas;
  await Promise.all(
    cacheFincas.map(async (finca) => {
      const urgentes = await incidenciasUrgentesPendientes(finca.id).catch(() => []);
      finca.__urgente = urgentes.length > 0;
    })
  );
  pintarListaFincas();
}

el.campoBuscarFinca?.addEventListener('input', () => pintarListaFincas());

async function seleccionarFinca(fincaId) {
  fincas.guardarFincaActiva(fincaId);
  await actualizarContexto();
  if (fincaId === 'todas') {
    mostrarVista('inicio');
    await renderizarInicio();
    return;
  }
  await renderizarSelectorArea(fincaId);
  mostrarVista('selectorArea');
}

async function renderizarSelectorArea(fincaId) {
  el.nombreFincaSeleccionArea.textContent = nombreFinca(fincaId);
  const listaAreas = await fincas.listarAreas(fincaId);
  el.listaAreas.innerHTML = '';

  if (listaAreas.length === 0) {
    const vacio = document.createElement('p');
    vacio.className = 'subtitulo-pantalla';
    vacio.textContent = navigator.onLine
      ? 'Esta finca todavía no tiene áreas registradas.'
      : 'No hay áreas guardadas en este dispositivo para esta finca todavía.';
    el.listaAreas.appendChild(vacio);
  }

  listaAreas.forEach((area) => {
    const item = document.createElement('div');
    item.className = 'item-area';
    item.innerHTML = `<span>${area.nombre}</span><span>›</span>`;
    item.addEventListener('click', async () => {
      fincas.guardarAreaActiva(area.id);
      await actualizarContexto();
      mostrarVista('inicio');
      await renderizarInicio();
    });
    el.listaAreas.appendChild(item);
  });

  const rolesQuePuedenCrearArea = ['administrador', 'encargado_finca'];
  el.botonAgregarArea.hidden = !rolesQuePuedenCrearArea.includes(cacheUsuario?.rol);
}

el.botonAgregarArea?.addEventListener('click', async () => {
  const nombre = prompt('Nombre de la nueva área (por ejemplo "Área 05"):');
  if (!nombre || !nombre.trim()) return;
  const fincaId = fincas.obtenerFincaActiva();
  await fincas.crearArea(fincaId, nombre.trim());
  await renderizarSelectorArea(fincaId);
});

// -------------------- Detalle de finca (modo "explorar", sin cambiar de contexto) --------------------

function filaEstadoFinca(nombre, ok, textoOk, textoMal) {
  const color = ok ? 'var(--verde-500)' : 'var(--rojo-500)';
  const emoji = ok ? '🟢' : '🟠';
  return elemento('div', { class: 'estado-finca__fila' }, [
    elemento('span', { class: 'estado-finca__nombre' }, `${emoji} ${nombre}`),
    elemento('span', { style: `color:${color}` }, ok ? textoOk : textoMal),
  ]);
}

async function abrirFincaDetalle(finca) {
  fincaDetalleActual = finca;
  el.fincaDetalleNombre.textContent = finca.nombre;

  const areas = await fincas.listarAreas(finca.id);
  const partes = [finca.ubicacion, finca.hectareas ? `${finca.hectareas} ha` : null, finca.plantas ? `${Number(finca.plantas).toLocaleString('es-CR')} plantas` : (areas.length ? `${areas.length} área(s)` : null)].filter(Boolean);
  el.fincaDetalleSubtitulo.textContent = partes.join(' · ');

  const stats = await estadisticasDeFinca(finca.id);
  el.fincaDetalleStats.innerHTML = '';
  el.fincaDetalleStats.appendChild(tarjetaStat('basket', stats.cortadoHoy.toLocaleString('es-CR'), 'Producción · racimos'));
  el.fincaDetalleStats.appendChild(tarjetaStat('package', stats.embolsadoHoy.toLocaleString('es-CR'), 'Embolse'));
  el.fincaDetalleStats.appendChild(tarjetaStat('crop', stats.cortadoHoy.toLocaleString('es-CR'), 'Corta'));
  el.fincaDetalleStats.appendChild(tarjetaStat('users', `${stats.personal.presentes}/${stats.personal.total}`, 'Personal'));
  el.fincaDetalleStats.appendChild(tarjetaStat('dollar', formatearMoneda(stats.ventasMes), 'Ventas · mes'));

  el.fincaDetalleEstado.innerHTML = '';
  el.fincaDetalleEstado.appendChild(filaEstadoFinca('Producción', true, 'Normal', 'Normal'));
  el.fincaDetalleEstado.appendChild(filaEstadoFinca('Labores', stats.atrasadas === 0, 'Al día', `${stats.atrasadas} atrasada(s)`));
  el.fincaDetalleEstado.appendChild(filaEstadoFinca('Inventario', stats.insumosBajos.length === 0, 'Normal', `Bajo (${stats.insumosBajos.length})`));
  el.fincaDetalleEstado.appendChild(filaEstadoFinca('Incidencias', stats.abiertas.length === 0, 'Sin pendientes', `${stats.abiertas.length} pendiente(s)`));

  mostrarVista('fincaDetalle');
}

el.botonVolverFincas?.addEventListener('click', () => {
  mostrarVista('selectorFinca');
});

el.botonEntrarFinca?.addEventListener('click', () => {
  if (fincaDetalleActual) seleccionarFinca(fincaDetalleActual.id);
});

// Módulos con datos sensibles (nómina, precios de venta) que no todo rol
// debería ver, aunque el backend ya rechace escrituras de esos roles — sin
// esto el usuario ve una tarjeta que lleva a una pantalla vacía o rechazada.
const MODULOS_RESTRINGIDOS = {
  planilla: ['administrador', 'encargado_finca', 'planilla'],
  ventas: ['administrador', 'encargado_finca'],
  usuarios: ['administrador'],
};

function actualizarVisibilidadModulos() {
  el.cuadriculaModulos?.querySelectorAll('.tarjeta-modulo').forEach((boton) => {
    const rolesPermitidos = MODULOS_RESTRINGIDOS[boton.dataset.modulo];
    boton.hidden = !!rolesPermitidos && !rolesPermitidos.includes(cacheUsuario?.rol);
  });
}

// Con una sola finca asignada no hay nada a lo que "cambiar".
function actualizarVisibilidadCuenta() {
  const permitidas = fincasPermitidas();
  if (el.botonCambiarFincaMas) el.botonCambiarFincaMas.hidden = !!(permitidas && permitidas.length === 1);
}

// -------------------- Apariencia (claro / oscuro / automático) --------------------

const CLAVE_TEMA = 'bananera:tema';
const consultaTemaSistema = window.matchMedia('(prefers-color-scheme: dark)');

function preferenciaTema() {
  const guardada = localStorage.getItem(CLAVE_TEMA);
  return guardada === 'claro' || guardada === 'oscuro' ? guardada : 'auto';
}

function calcularTemaEfectivo() {
  const preferencia = preferenciaTema();
  if (preferencia !== 'auto') return preferencia;
  return consultaTemaSistema.matches ? 'oscuro' : 'claro';
}

function actualizarBotonesTema() {
  const preferencia = preferenciaTema();
  el.selectorTema?.querySelectorAll('.selector-tema__opcion').forEach((boton) => {
    boton.classList.toggle('selector-tema__opcion--activa', boton.dataset.tema === preferencia);
  });
}

function aplicarTema() {
  document.documentElement.setAttribute('data-tema-efectivo', calcularTemaEfectivo());
  actualizarBotonesTema();
}

el.selectorTema?.addEventListener('click', (evento) => {
  const boton = evento.target.closest('.selector-tema__opcion');
  if (!boton) return;
  if (boton.dataset.tema === 'auto') localStorage.removeItem(CLAVE_TEMA);
  else localStorage.setItem(CLAVE_TEMA, boton.dataset.tema);
  aplicarTema();
});

// Si el usuario dejó "Automático" y cambia el tema del sistema operativo
// mientras la app está abierta, se refleja sin que tenga que recargar.
consultaTemaSistema.addEventListener('change', () => {
  if (preferenciaTema() === 'auto') aplicarTema();
});

// -------------------- Notificaciones push (incidencias urgentes) --------------------

/** applicationServerKey debe ir como Uint8Array, no como el string base64url que da el servidor. */
function urlBase64ToUint8Array(base64String) {
  const relleno = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const binario = atob(base64);
  return Uint8Array.from([...binario].map((c) => c.charCodeAt(0)));
}

function soportaPush() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function suscripcionActual() {
  if (!soportaPush()) return null;
  const registro = await navigator.serviceWorker.ready;
  return registro.pushManager.getSubscription();
}

async function actualizarBotonNotificaciones() {
  if (!el.botonNotificaciones) return;
  if (!soportaPush()) {
    el.botonNotificaciones.hidden = true;
    return;
  }
  el.botonNotificaciones.hidden = false;
  const suscripcion = await suscripcionActual().catch(() => null);
  const activo = !!suscripcion && Notification.permission === 'granted';
  el.botonNotificaciones.classList.toggle('item-cuenta--activo', activo);
  const texto = el.botonNotificaciones.querySelector('.texto-notificaciones');
  if (texto) texto.textContent = activo ? '🔔 Notificaciones activadas (tocar para desactivar)' : 'Activar notificaciones de incidencias urgentes';
}

async function enviarSuscripcionAlServidor(suscripcion) {
  const token = await auth.obtenerToken();
  await fetch(`${API_BASE_URL}/notificaciones/suscribir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(suscripcion.toJSON()),
  });
}

async function activarNotificaciones() {
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    alert('No se otorgó permiso de notificaciones. Puedes activarlo luego desde los ajustes del navegador para este sitio.');
    return;
  }
  const respuesta = await fetch(`${API_BASE_URL}/notificaciones/clave-publica`);
  const { clavePublica, disponible } = await respuesta.json();
  if (!disponible || !clavePublica) {
    alert('Las notificaciones todavía no están configuradas en el servidor. Avísale al administrador del sistema.');
    return;
  }
  const registro = await navigator.serviceWorker.ready;
  const suscripcion = await registro.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(clavePublica),
  });
  await enviarSuscripcionAlServidor(suscripcion);
}

async function desactivarNotificaciones(suscripcion) {
  try {
    const token = await auth.obtenerToken();
    await fetch(`${API_BASE_URL}/notificaciones/suscribir`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: suscripcion.endpoint }),
    });
  } catch {
    // si falla el aviso al servidor, igual se desuscribe localmente abajo —
    // la fila queda huérfana en el servidor pero el push a un endpoint
    // muerto simplemente falla y se limpia sola del lado del servidor.
  }
  await suscripcion.unsubscribe();
}

el.botonNotificaciones?.addEventListener('click', async () => {
  el.botonNotificaciones.disabled = true;
  try {
    const existente = await suscripcionActual();
    if (existente && Notification.permission === 'granted') {
      await desactivarNotificaciones(existente);
    } else {
      await activarNotificaciones();
    }
  } catch (error) {
    console.error('[app] Error activando/desactivando notificaciones:', error);
    alert('No se pudo cambiar el estado de las notificaciones en este dispositivo.');
  } finally {
    el.botonNotificaciones.disabled = false;
    await actualizarBotonNotificaciones();
  }
});

// Aviso dentro de la app cuando llega un push con la página abierta (además
// de la notificación real del sistema, que siempre la muestra el service
// worker aunque la app esté cerrada — ver service-worker.js).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (evento) => {
    if (evento.data?.tipo !== 'bananera:push') return;
    const payload = evento.data.payload || {};
    mostrarToast({
      titulo: payload.titulo || 'Nueva notificación',
      mensaje: payload.mensaje,
      alHacerClick: () => abrirModulo('incidencias'),
    });
  });
}

async function renderizarInicio() {
  el.bienvenidaUsuario.textContent = cacheUsuario ? `Hola, ${cacheUsuario.nombre}` : '';
  el.contextoInicio.textContent = el.contexto.textContent;
  try {
    await renderizarDashboard(el.contenedorDashboard, contextoActual(), {
      alTocarIncidencias: () => abrirModulo('incidencias'),
      alTocarPersonal: () => abrirModulo('planilla', 'empleados'),
    });
  } catch (error) {
    console.warn('[app] No se pudo calcular el dashboard:', error);
  }
}

// -------------------- Router de módulos --------------------

el.cuadriculaModulos?.addEventListener('click', async (evento) => {
  const boton = evento.target.closest('.tarjeta-modulo');
  if (!boton) return;
  await abrirModulo(boton.dataset.modulo);
});

async function abrirModulo(clave, tabClave) {
  const modulo = MODULOS[clave];
  if (!modulo) return;
  moduloActivoClave = clave;
  el.tituloModulo.textContent = modulo.etiqueta;
  el.contenedorModulo.innerHTML = '';
  mostrarVista('modulo');
  try {
    await modulo.render(el.contenedorModulo, contextoActual());
    if (tabClave) {
      el.contenedorModulo.querySelector(`.pestana[data-clave="${tabClave}"]`)?.click();
    }
  } catch (error) {
    console.error(`[app] Error mostrando el módulo ${clave}:`, error);
    el.contenedorModulo.appendChild(
      Object.assign(document.createElement('p'), {
        className: 'mensaje-error mensaje-error--error',
        textContent: 'No se pudo cargar este módulo. Intenta de nuevo.',
      })
    );
  }
}

el.botonVolverInicio?.addEventListener('click', async () => {
  mostrarVista('inicio');
  await renderizarInicio();
});

// -------------------- Navegación inferior + acciones rápidas --------------------

el.navInferior?.addEventListener('click', async (evento) => {
  const boton = evento.target.closest('[data-nav]');
  if (!boton) return;
  const destino = boton.dataset.nav;
  if (destino === 'inicio') {
    mostrarVista('inicio');
    await renderizarInicio();
  } else if (destino === 'fincas') {
    mostrarVista('selectorFinca');
    await renderizarSelectorFinca();
  } else if (destino === 'reportes') {
    await abrirModulo('reportes');
  } else if (destino === 'mas') {
    actualizarVisibilidadModulos();
    actualizarVisibilidadCuenta();
    actualizarBotonesTema();
    await actualizarBotonNotificaciones();
    mostrarVista('mas');
  }
});

el.botonRegistrar?.addEventListener('click', () => {
  if (el.hojaRegistrar) el.hojaRegistrar.hidden = false;
});

el.hojaRegistrar?.addEventListener('click', (evento) => {
  if (evento.target === el.hojaRegistrar) {
    el.hojaRegistrar.hidden = true;
    return;
  }
  const boton = evento.target.closest('.accion-rapida');
  if (!boton) return;
  if (boton.id === 'accion-gasto') {
    alert('El módulo de Gastos todavía no está disponible.');
    return;
  }
  el.hojaRegistrar.hidden = true;
  abrirModulo(boton.dataset.modulo, boton.dataset.tab);
});

el.botonCambiarFincaMas?.addEventListener('click', () => {
  fincas.limpiarSeleccion();
  el.contexto.textContent = '';
  mostrarVista('selectorFinca');
  renderizarSelectorFinca();
});

el.botonSalirMas?.addEventListener('click', async () => {
  await auth.cerrarSesion();
  cacheUsuario = null;
  mostrarVista('login');
});

el.botonSyncAhora?.addEventListener('click', () => {
  sincronizarAhora();
});

// Cuando termina de sincronizar (llegaron cambios de otro dispositivo), se
// refresca la pantalla que esté abierta para que se vean sin tener que
// navegar manualmente.
document.addEventListener('bananera:estado-sync', async (evento) => {
  if (evento.detail.estado !== 'sincronizado') return;
  if (vistaActual === 'inicio') await renderizarInicio();
  else if (vistaActual === 'modulo' && moduloActivoClave) {
    // No pisar un formulario a medio llenar: si el usuario tarda más que un
    // ciclo de sync (30s) en terminar de escribir, este refresco automático
    // le borraba lo que llevaba. Se reintenta en el próximo sync exitoso.
    if (hayFormularioSinGuardar(el.contenedorModulo)) return;
    try {
      await MODULOS[moduloActivoClave].render(el.contenedorModulo, contextoActual());
    } catch {
      /* si el módulo activo falla al refrescar en segundo plano, se deja como estaba */
    }
  }
});

const NOMBRE_TABLA_LEGIBLE = {
  empleados: 'trabajador',
  equipos: 'equipo',
  asistencia: 'asistencia',
  incidencias: 'incidencia',
  insumos: 'insumo',
  areas: 'área',
  entregas_platano: 'entrega de plátano',
  entregas_banano: 'entrega de banano',
  ventas_platano: 'venta de plátano',
  ventas_banano: 'venta de banano',
  embolse: 'embolse',
  corta: 'corta',
};

// El servidor rechazó un registro (dato inválido/duplicado, nunca un
// problema de red) — se avisa YA, en vez de que quede solo en la consola
// (ver la nota en syncClient.js sobre por qué esto importa).
document.addEventListener('bananera:operacion-rechazada', (evento) => {
  const { tabla, motivo } = evento.detail;
  const nombre = NOMBRE_TABLA_LEGIBLE[tabla] || tabla;
  mostrarToast({
    titulo: `No se pudo guardar (${nombre})`,
    mensaje: motivo,
    alHacerClick: () => abrirModulo('reportes', 'sync'),
  });
});

el.formLogin?.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  el.errorLogin.textContent = '';
  const usuario = el.campoUsuario.value.trim();
  const password = el.campoPassword.value;
  try {
    const resultado = await auth.iniciarSesion(usuario, password);
    cacheUsuario = resultado.usuario;
    if (resultado.avisoConexion) {
      el.errorLogin.textContent = '📴 Entraste con la última sesión guardada en este dispositivo (sin conexión ahora).';
      el.errorLogin.style.color = 'var(--ambar-600)';
    }
    iniciarSyncClient();
    await continuarDespuesDeLogin();
  } catch (error) {
    el.errorLogin.textContent = error.message;
    el.errorLogin.style.color = 'var(--rojo-500)';
  }
});

async function continuarDespuesDeLogin() {
  let fincaId = fincas.obtenerFincaActiva();
  const permitidas = fincasPermitidas();

  // Si quedó guardada una finca a la que este usuario ya no tiene acceso
  // (el administrador le reasignó las fincas después de haberla elegido),
  // se limpia para que vuelva a elegir entre las que sí puede ver.
  if (fincaId && fincaId !== 'todas' && permitidas && !permitidas.includes(fincaId)) {
    fincas.limpiarSeleccion();
    fincaId = null;
  }

  if (!fincaId) {
    // Con una sola finca asignada no hay nada que elegir — se entra
    // directo, sin mostrar el selector.
    if (permitidas && permitidas.length === 1) {
      fincas.guardarFincaActiva(permitidas[0]);
      fincaId = permitidas[0];
    } else {
      mostrarVista('selectorFinca');
      await renderizarSelectorFinca();
      return;
    }
  }
  cacheFincas = await fincas.listar();
  await actualizarContexto();
  if (fincaId === 'todas') {
    mostrarVista('inicio');
    await renderizarInicio();
    return;
  }
  const areaId = fincas.obtenerAreaActiva();
  if (!areaId) {
    await renderizarSelectorArea(fincaId);
    mostrarVista('selectorArea');
    return;
  }
  mostrarVista('inicio');
  await renderizarInicio();
}

async function iniciar() {
  hidratarIconos();
  aplicarTema();
  await obtenerIdDispositivo();
  iniciarIndicadorConexion();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('[app] No se pudo registrar el service worker:', err);
    });
  }

  const sesion = await auth.sesionActual();
  if (!sesion) {
    mostrarVista('login');
    return;
  }
  cacheUsuario = sesion.usuario;
  iniciarSyncClient();
  await continuarDespuesDeLogin();
}

iniciar();

// Expuesto para depuración manual desde la consola si hace falta forzar un
// intento de sincronización (por ejemplo durante pruebas de campo).
window.bananeraSincronizarAhora = sincronizarAhora;
