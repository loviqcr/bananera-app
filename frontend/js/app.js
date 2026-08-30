import { localdb, obtenerIdDispositivo } from './db/localdb.js';
import { auth } from './modules/auth.js';
import { fincas } from './modules/fincas.js';
import { iniciarIndicadorConexion } from './modules/estadoConexion.js';
import { iniciarSyncClient, sincronizarAhora } from './sync/syncClient.js';

const ICONOS_FINCA = ['🌱', '🍌', '🌴', '🚜'];

const vistas = {
  login: document.getElementById('vista-login'),
  selectorFinca: document.getElementById('vista-selector-finca'),
  selectorArea: document.getElementById('vista-selector-area'),
  inicio: document.getElementById('vista-inicio'),
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
};

let cacheUsuario = null;
let cacheFincas = [];

function mostrarVista(nombre) {
  for (const [clave, nodo] of Object.entries(vistas)) {
    if (!nodo) continue;
    nodo.hidden = clave !== nombre;
  }
  const enSesion = nombre !== 'login';
  el.botonCambiarFinca.hidden = !enSesion || nombre === 'selectorFinca';
  el.botonSalir.hidden = !enSesion;
}

function nombreFinca(id) {
  if (id === 'todas') return 'Todas las fincas';
  return cacheFincas.find((f) => f.id === id)?.nombre ?? 'Finca';
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
    const tarjeta = document.createElement('button');
    tarjeta.className = 'tarjeta-finca';
    tarjeta.innerHTML = `<span class="tarjeta-finca__icono">${ICONOS_FINCA[i % ICONOS_FINCA.length]}</span><span>${finca.nombre}</span>`;
    tarjeta.addEventListener('click', () => seleccionarFinca(finca.id));
    el.cuadriculaFincas.appendChild(tarjeta);
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
    renderizarInicio();
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
      renderizarInicio();
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

function renderizarInicio() {
  el.bienvenidaUsuario.textContent = cacheUsuario ? `Hola, ${cacheUsuario.nombre}` : '';
  el.contextoInicio.textContent = el.contexto.textContent;
}

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
    renderizarInicio();
    return;
  }
  const areaId = fincas.obtenerAreaActiva();
  if (!areaId) {
    await renderizarSelectorArea(fincaId);
    mostrarVista('selectorArea');
    return;
  }
  mostrarVista('inicio');
  renderizarInicio();
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
