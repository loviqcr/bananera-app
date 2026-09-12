import { localdb, obtenerIdDispositivo } from './db/localdb.js';
import { auth } from './modules/auth.js';
import { fincas } from './modules/fincas.js';
import { iniciarIndicadorConexion } from './modules/estadoConexion.js';
import { iniciarSyncClient, sincronizarAhora } from './sync/syncClient.js';
import { renderizarDashboard } from './modules/dashboard.js';
import { hayFormularioSinGuardar } from './ui.js';
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

const ICONOS_FINCA = ['🌱', '🍌', '🌴', '🚜'];

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
  inicio: document.getElementById('vista-inicio'),
  modulo: document.getElementById('vista-modulo'),
};

const el = {
  formLogin: document.getElementById('form-login'),
  campoUsuario: document.getElementById('campo-usuario'),
  campoPassword: document.getElementById('campo-password'),
  errorLogin: document.getElementById('error-login'),
  cuadriculaFincas: document.getElementById('cuadricula-fincas'),
  listaAreas: document.getElementById('lista-areas'),
  nombreFincaSeleccionArea: document.getElementById('nombre-finca-seleccion-area'),
  botonAgregarArea: document.getElementById('boton-agregar-area'),
  botonCambiarFinca: document.getElementById('boton-cambiar-finca'),
  botonSalir: document.getElementById('boton-salir'),
  contexto: document.getElementById('barra-contexto'),
  bienvenidaUsuario: document.getElementById('bienvenida-usuario'),
  contextoInicio: document.getElementById('contexto-inicio'),
  contenedorDashboard: document.getElementById('contenedor-dashboard'),
  cuadriculaModulos: document.getElementById('cuadricula-modulos'),
  botonVolverInicio: document.getElementById('boton-volver-inicio'),
  tituloModulo: document.getElementById('titulo-modulo'),
  contenedorModulo: document.getElementById('contenedor-modulo'),
};

let cacheUsuario = null;
let cacheFincas = [];
let vistaActual = 'login';
let moduloActivoClave = null;

function mostrarVista(nombre) {
  vistaActual = nombre;
  for (const [clave, nodo] of Object.entries(vistas)) {
    if (!nodo) continue;
    nodo.hidden = clave !== nombre;
  }
  const enSesion = nombre !== 'login';
  el.botonCambiarFinca.hidden = !enSesion || nombre === 'selectorFinca';
  el.botonSalir.hidden = !enSesion;
  if (nombre !== 'modulo') moduloActivoClave = null;
}

function nombreFinca(id) {
  if (id === 'todas') return 'Todas las fincas';
  return cacheFincas.find((f) => f.id === id)?.nombre ?? 'Finca';
}

function contextoActual() {
  return { fincaId: fincas.obtenerFincaActiva(), areaId: fincas.obtenerAreaActiva() };
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

async function renderizarSelectorFinca() {
  cacheFincas = await fincas.listar();
  el.cuadriculaFincas.innerHTML = '';

  cacheFincas.forEach((finca, i) => {
    const envoltorio = document.createElement('div');
    envoltorio.className = 'tarjeta-finca-envoltorio';

    const tarjeta = document.createElement('button');
    tarjeta.className = 'tarjeta-finca';
    tarjeta.innerHTML = `<span class="tarjeta-finca__icono">${ICONOS_FINCA[i % ICONOS_FINCA.length]}</span><span>${finca.nombre}</span>`;
    tarjeta.addEventListener('click', () => seleccionarFinca(finca.id));
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
  });

  const todas = document.createElement('button');
  todas.className = 'tarjeta-finca tarjeta-finca--todas';
  todas.innerHTML = `<span class="tarjeta-finca__icono">🗂️</span><span>Todas las fincas</span>`;
  todas.addEventListener('click', () => seleccionarFinca('todas'));
  el.cuadriculaFincas.appendChild(todas);
}

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

async function renderizarInicio() {
  el.bienvenidaUsuario.textContent = cacheUsuario ? `Hola, ${cacheUsuario.nombre}` : '';
  el.contextoInicio.textContent = el.contexto.textContent;
  actualizarVisibilidadModulos();
  try {
    await renderizarDashboard(el.contenedorDashboard, contextoActual());
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

async function abrirModulo(clave) {
  const modulo = MODULOS[clave];
  if (!modulo) return;
  moduloActivoClave = clave;
  el.tituloModulo.textContent = modulo.etiqueta;
  el.contenedorModulo.innerHTML = '';
  mostrarVista('modulo');
  try {
    await modulo.render(el.contenedorModulo, contextoActual());
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

el.botonCambiarFinca?.addEventListener('click', () => {
  fincas.limpiarSeleccion();
  el.contexto.textContent = '';
  mostrarVista('selectorFinca');
  renderizarSelectorFinca();
});

el.botonSalir?.addEventListener('click', async () => {
  await auth.cerrarSesion();
  cacheUsuario = null;
  mostrarVista('login');
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
  const fincaId = fincas.obtenerFincaActiva();
  if (!fincaId) {
    mostrarVista('selectorFinca');
    await renderizarSelectorFinca();
    return;
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
