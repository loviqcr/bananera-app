import { elemento } from '../ui.js';
import { auth } from './auth.js';
import { fincas } from './fincas.js';
import { API_BASE_URL } from '../config.js';

const ROLES = [
  { value: 'administrador', label: 'Administrador' },
  { value: 'encargado_finca', label: 'Encargado de finca' },
  { value: 'bodega', label: 'Bodega' },
  { value: 'planilla', label: 'Planilla' },
  { value: 'trabajador', label: 'Trabajador' },
];

function etiquetaRol(valor) {
  return ROLES.find((r) => r.value === valor)?.label ?? valor;
}

async function cabecerasAuth() {
  const token = await auth.obtenerToken();
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function listarUsuarios() {
  const respuesta = await fetch(`${API_BASE_URL}/usuarios`, { headers: await cabecerasAuth() });
  if (!respuesta.ok) throw new Error('No se pudo cargar la lista de usuarios (¿tenés conexión?)');
  return respuesta.json();
}

async function crearUsuario(datos) {
  const respuesta = await fetch(`${API_BASE_URL}/usuarios`, {
    method: 'POST',
    headers: await cabecerasAuth(),
    body: JSON.stringify(datos),
  });
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo crear el usuario');
  return cuerpo;
}

async function actualizarUsuario(id, datos) {
  const respuesta = await fetch(`${API_BASE_URL}/usuarios/${id}`, {
    method: 'PATCH',
    headers: await cabecerasAuth(),
    body: JSON.stringify(datos),
  });
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo actualizar el usuario');
  return cuerpo;
}

function grupoCasillasFincas(listaFincas, seleccionadas) {
  const contenedor = elemento('div', { class: 'fila', style: 'flex-wrap:wrap;gap:12px' });
  const casillas = {};
  for (const finca of listaFincas) {
    const casilla = elemento('input', { type: 'checkbox', value: finca.id });
    casilla.checked = seleccionadas.includes(finca.id);
    casillas[finca.id] = casilla;
    const etiqueta = elemento('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:400' }, [casilla, finca.nombre]);
    contenedor.appendChild(etiqueta);
  }
  return { contenedor, obtenerSeleccionadas: () => Object.entries(casillas).filter(([, c]) => c.checked).map(([id]) => id) };
}

function renderizarFormularioCrear(contenedor, listaFincas, alCrear) {
  const campoNombre = elemento('input', { type: 'text', required: 'true' });
  const campoUsuario = elemento('input', { type: 'text', required: 'true' });
  const campoPassword = elemento('input', { type: 'password', required: 'true', minlength: '6' });
  const selectorRol = elemento('select', {});
  for (const rol of ROLES) selectorRol.appendChild(elemento('option', { value: rol.value }, rol.label));

  const { contenedor: casillasFincas, obtenerSeleccionadas } = grupoCasillasFincas(listaFincas, []);
  const mensaje = elemento('div', { class: 'mensaje-error mensaje-error--error' });
  const boton = elemento('button', { type: 'submit', class: 'boton boton--primario', texto: '+ Crear usuario' });

  const form = elemento('form', { class: 'tarjeta' }, [
    elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Nombre completo' }), campoNombre]),
    elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Usuario (para iniciar sesión)' }), campoUsuario]),
    elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Contraseña' }), campoPassword]),
    elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Rol' }), selectorRol]),
    elemento('div', { class: 'campo' }, [
      elemento('label', { texto: 'Fincas asignadas (no aplica si el rol es Administrador o Bodega, que ven todas)' }),
      casillasFincas,
    ]),
    mensaje,
    boton,
  ]);

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mensaje.textContent = '';
    boton.disabled = true;
    try {
      await alCrear({
        nombre: campoNombre.value.trim(),
        usuario: campoUsuario.value.trim(),
        password: campoPassword.value,
        rol: selectorRol.value,
        fincaIds: obtenerSeleccionadas(),
      });
      form.reset();
    } catch (error) {
      mensaje.textContent = error.message;
    } finally {
      boton.disabled = false;
    }
  });

  contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem' }, '+ Nuevo usuario'));
  contenedor.appendChild(form);
}

function renderizarFilaUsuario(usuario, listaFincas, alGuardar) {
  const fila = elemento('div', { class: 'tarjeta' });
  const encabezado = elemento('div', { class: 'fila', style: 'justify-content:space-between;align-items:center' }, [
    elemento('div', {}, [
      elemento('div', { style: 'font-weight:700' }, `${usuario.nombre} (${usuario.usuario})`),
      elemento('div', { class: 'fila', style: 'gap:6px;margin-top:4px' }, [
        elemento('span', { class: 'chip' }, etiquetaRol(usuario.rol)),
        !usuario.activo ? elemento('span', { class: 'chip', style: 'background:var(--rojo-100,#fee2e2);color:var(--rojo-500,#ef4444)' }, 'Inactivo') : null,
      ]),
    ]),
    elemento('button', { type: 'button', class: 'boton boton--fantasma', texto: '✏️ Editar' }),
  ]);
  fila.appendChild(encabezado);

  const zonaEdicion = elemento('div', { hidden: 'true', style: 'margin-top:12px' });
  fila.appendChild(zonaEdicion);

  const botonEditar = encabezado.querySelector('button');
  botonEditar.addEventListener('click', () => {
    const abrir = zonaEdicion.hidden;
    zonaEdicion.hidden = !abrir;
    zonaEdicion.innerHTML = '';
    if (!abrir) return;

    const selectorRol = elemento('select', {});
    for (const rol of ROLES) selectorRol.appendChild(elemento('option', { value: rol.value }, rol.label));
    selectorRol.value = usuario.rol;

    const { contenedor: casillasFincas, obtenerSeleccionadas } = grupoCasillasFincas(listaFincas, usuario.finca_ids ?? []);

    const casillaActivo = elemento('input', { type: 'checkbox' });
    casillaActivo.checked = usuario.activo;

    const mensaje = elemento('div', { class: 'mensaje-error mensaje-error--error' });
    const botonGuardar = elemento('button', { type: 'button', class: 'boton boton--primario', texto: 'Guardar cambios' });

    zonaEdicion.appendChild(elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Rol' }), selectorRol]));
    zonaEdicion.appendChild(elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Fincas asignadas' }), casillasFincas]));
    zonaEdicion.appendChild(elemento('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:400;margin:8px 0' }, [casillaActivo, 'Usuario activo (puede iniciar sesión)']));
    zonaEdicion.appendChild(mensaje);
    zonaEdicion.appendChild(botonGuardar);

    botonGuardar.addEventListener('click', async () => {
      mensaje.textContent = '';
      botonGuardar.disabled = true;
      try {
        await alGuardar(usuario.id, {
          rol: selectorRol.value,
          fincaIds: obtenerSeleccionadas(),
          activo: casillaActivo.checked,
        });
        zonaEdicion.hidden = true;
      } catch (error) {
        mensaje.textContent = error.message;
      } finally {
        botonGuardar.disabled = false;
      }
    });
  });

  return fila;
}

export const usuariosModulo = {
  etiqueta: 'Usuarios',
  async render(contenedor) {
    contenedor.innerHTML = '';

    if (!navigator.onLine) {
      contenedor.appendChild(elemento('p', { class: 'mensaje-error mensaje-error--aviso', texto: '📴 Necesitás conexión a internet para administrar usuarios.' }));
      return;
    }

    const listaFincas = await fincas.listar();
    const zonaLista = elemento('div', { style: 'margin-top:24px' });

    async function refrescarLista() {
      zonaLista.innerHTML = '';
      zonaLista.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem' }, 'Usuarios existentes'));
      try {
        const usuarios = await listarUsuarios();
        for (const usuario of usuarios) {
          zonaLista.appendChild(
            renderizarFilaUsuario(usuario, listaFincas, async (id, datos) => {
              await actualizarUsuario(id, datos);
              await refrescarLista();
            })
          );
        }
      } catch (error) {
        zonaLista.appendChild(elemento('p', { class: 'mensaje-error mensaje-error--error', texto: error.message }));
      }
    }

    renderizarFormularioCrear(contenedor, listaFincas, async (datos) => {
      await crearUsuario(datos);
      await refrescarLista();
    });
    contenedor.appendChild(zonaLista);
    await refrescarLista();
  },
};
