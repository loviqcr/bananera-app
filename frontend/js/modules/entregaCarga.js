import { repos } from '../db/repos.js';
import { localdb, generarUUID } from '../db/localdb.js';
import { auth } from './auth.js';
import { elemento, hoyISO, marcarSucio, limpiarSucio } from '../ui.js';

async function esAdministrador() {
  const sesion = await auth.sesionActual();
  return sesion?.usuario?.rol === 'administrador';
}

async function opcionesResponsables() {
  const todos = await repos.listarTodos('responsables_carga');
  return todos.filter((r) => r.activo).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

async function agregarResponsable() {
  const nombre = prompt('¿A quién se le entrega? (nombre del transportista/comprador):');
  if (!nombre || !nombre.trim()) return null;
  return repos.crear('responsables_carga', { nombre: nombre.trim(), activo: true });
}

/**
 * Corrige el nombre de un destinatario (ej. un error de digitación) y lo
 * arrastra también a las entregas YA guardadas con el nombre anterior —
 * responsable_nombre es texto suelto, no una referencia, así que sin esto
 * el historial y los resúmenes por semana se quedarían con el nombre viejo.
 */
async function editarResponsable(r) {
  const nuevoNombre = prompt('Corregir nombre de destinatario:', r.nombre);
  if (!nuevoNombre || !nuevoNombre.trim() || nuevoNombre.trim() === r.nombre) return null;
  const nombreLimpio = nuevoNombre.trim();
  await repos.editar('responsables_carga', r.id, { nombre: nombreLimpio });
  const entregasPrevias = (await repos.listarTodos('entregas_platano')).filter((e) => e.responsable_nombre === r.nombre);
  for (const e of entregasPrevias) {
    await repos.editar('entregas_platano', e.id, { responsable_nombre: nombreLimpio });
  }
  return { ...r, nombre: nombreLimpio };
}

function fechaCorta(fechaISO) {
  const fecha = new Date(fechaISO + 'T00:00:00');
  const texto = fecha.toLocaleDateString('es-CR', { weekday: 'short', day: 'numeric', month: 'short' });
  return texto.charAt(0).toUpperCase() + texto.slice(1).replace('.', '');
}

/**
 * Control +/- reutilizado para Cajas de primera/segunda — el número también
 * se puede escribir a mano. `contenedorModulo` se usa para marcar "sucio" al
 * tocar +/- (el campo de texto ya queda cubierto solo por la red de
 * seguridad genérica en app.js, pero los clics en <button> no disparan
 * 'input'/'change', así que hay que marcarlo a mano acá).
 */
function crearStepper(colorBoton, contenedorModulo) {
  let valor = 0;
  const campoValor = elemento('input', { type: 'number', inputmode: 'numeric', min: '0', class: 'stepper__valor', value: '0' });
  const fijarValor = (nuevo) => {
    valor = Math.max(0, Math.trunc(Number(nuevo) || 0));
    campoValor.value = String(valor);
  };
  campoValor.addEventListener('input', () => fijarValor(campoValor.value));
  campoValor.addEventListener('blur', () => fijarValor(campoValor.value)); // por si queda vacío o con "-" suelto al salir del campo
  const botonMenos = elemento('button', {
    type: 'button',
    class: 'boton-stepper',
    texto: '−',
    onclick: () => {
      fijarValor(valor - 1);
      marcarSucio(contenedorModulo);
    },
  });
  const botonMas = elemento('button', {
    type: 'button',
    class: `boton-stepper boton-stepper--${colorBoton}`,
    texto: '+',
    onclick: () => {
      fijarValor(valor + 1);
      marcarSucio(contenedorModulo);
    },
  });
  const contenedor = elemento('div', { class: 'stepper' }, [botonMenos, campoValor, botonMas]);
  return {
    contenedor,
    obtenerValor: () => valor,
    reiniciar: () => fijarValor(0),
  };
}

/** Entregas de hoy creadas por esta pantalla (traen grupo_entrega), agrupadas por toque de "Guardar entrega". */
async function entregasCargaHoy(fincaId, areaId) {
  const hoy = hoyISO();
  const todas = (await repos.listarPorFinca('entregas_platano', fincaId)).filter(
    (e) => e.area_id === areaId && e.fecha === hoy && e.grupo_entrega
  );
  const grupos = new Map();
  for (const fila of todas) {
    const grupo = grupos.get(fila.grupo_entrega) ?? {
      grupo: fila.grupo_entrega,
      responsable: fila.responsable_nombre || 'Sin destinatario',
      primera: 0,
      segunda: 0,
      observaciones: fila.observaciones || '',
      actualizadoEn: fila.updated_at,
      ids: [],
    };
    grupo[fila.calidad] += Number(fila.cantidad_cajas) || 0;
    grupo.ids.push(fila.id);
    if (fila.updated_at > grupo.actualizadoEn) grupo.actualizadoEn = fila.updated_at;
    grupos.set(fila.grupo_entrega, grupo);
  }
  return Array.from(grupos.values()).sort((a, b) => (a.actualizadoEn < b.actualizadoEn ? 1 : -1));
}

/** Usado por el dashboard: total de cajas de HOY en toda la finca (todas las áreas), no solo la actual. */
export async function estadisticasHoy(fincaId) {
  const hoy = hoyISO();
  const todas = (await repos.listarPorFinca('entregas_platano', fincaId)).filter((e) => e.fecha === hoy && e.grupo_entrega);
  const primera = todas.filter((e) => e.calidad === 'primera').reduce((s, e) => s + (Number(e.cantidad_cajas) || 0), 0);
  const segunda = todas.filter((e) => e.calidad === 'segunda').reduce((s, e) => s + (Number(e.cantidad_cajas) || 0), 0);
  const porDestinatarioMapa = new Map();
  for (const e of todas) {
    if (!e.responsable_nombre) continue;
    const actual = porDestinatarioMapa.get(e.responsable_nombre) ?? { nombre: e.responsable_nombre, primera: 0, segunda: 0 };
    actual[e.calidad] += Number(e.cantidad_cajas) || 0;
    porDestinatarioMapa.set(e.responsable_nombre, actual);
  }
  const porDestinatario = Array.from(porDestinatarioMapa.values()).sort((a, b) => b.primera + b.segunda - (a.primera + a.segunda));
  return { primera, segunda, total: primera + segunda, porDestinatario };
}

/** A quién fue la última entrega de carga de una finca, sin importar el día — usado en el dashboard "Detalle por finca". */
export async function ultimoDestinatario(fincaId) {
  const todas = (await repos.listarPorFinca('entregas_platano', fincaId)).filter((e) => e.grupo_entrega && e.responsable_nombre);
  if (!todas.length) return null;
  const masReciente = todas.reduce((a, b) => (a.updated_at > b.updated_at ? a : b));
  return { nombre: masReciente.responsable_nombre, fecha: masReciente.fecha };
}

function inicioSemanaDe(fechaISO) {
  const fecha = new Date(fechaISO + 'T00:00:00');
  const dia = fecha.getDay() === 0 ? 7 : fecha.getDay(); // lunes = 1 ... domingo = 7
  fecha.setDate(fecha.getDate() - (dia - 1));
  return fecha.toISOString().slice(0, 10);
}

/**
 * Desglose de Entrega de Carga por semana (cajas de primera/segunda, y a
 * quién se le entregó cada una) — para que el administrador lo vea de un
 * vistazo desde Inicio tocando la tarjeta "Entrega de carga". `fincaId` es
 * el mismo contexto de Inicio: 'todas' suma todas las fincas, una finca
 * específica solo la de ella.
 */
export async function resumenEntregaPorSemana(fincaId, semanas = 8) {
  const todas = (await repos.listarPorFinca('entregas_platano', fincaId)).filter((e) => e.grupo_entrega);
  const porSemana = new Map();
  for (const e of todas) {
    const semana = inicioSemanaDe(e.fecha);
    const actual = porSemana.get(semana) ?? { semana, primera: 0, segunda: 0, porDestinatarioMapa: new Map() };
    if (e.calidad === 'primera' || e.calidad === 'segunda') actual[e.calidad] += Number(e.cantidad_cajas) || 0;
    if (e.responsable_nombre) {
      const nombre = e.responsable_nombre;
      const destinatario = actual.porDestinatarioMapa.get(nombre) ?? { nombre, primera: 0, segunda: 0 };
      if (e.calidad === 'primera' || e.calidad === 'segunda') destinatario[e.calidad] += Number(e.cantidad_cajas) || 0;
      actual.porDestinatarioMapa.set(nombre, destinatario);
    }
    porSemana.set(semana, actual);
  }
  return Array.from(porSemana.values())
    .map((f) => ({
      semana: f.semana,
      primera: f.primera,
      segunda: f.segunda,
      porDestinatario: Array.from(f.porDestinatarioMapa.values()).sort((a, b) => b.primera + b.segunda - (a.primera + a.segunda)),
    }))
    .sort((a, b) => (a.semana < b.semana ? 1 : -1))
    .slice(0, semanas);
}

export const entregaCargaModulo = {
  etiqueta: 'Entrega de Carga',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';

    if (contexto.fincaId === 'todas' || !contexto.areaId) {
      contenedor.appendChild(
        elemento('p', { class: 'subtitulo-pantalla', texto: 'Selecciona una finca y un área específicas para registrar una entrega de carga.' })
      );
      return;
    }

    const [fincas, areas, responsables, esAdmin] = await Promise.all([
      repos.listarTodos('fincas'),
      repos.listarPorFinca('areas', contexto.fincaId),
      opcionesResponsables(),
      esAdministrador(),
    ]);
    const finca = fincas.find((f) => f.id === contexto.fincaId);
    const area = areas.find((a) => a.id === contexto.areaId);

    // ---- Banner de contexto (finca · área + fecha) ----
    const etiquetaFecha = elemento('span', { class: 'banner-entrega-carga__fecha', texto: fechaCorta(hoyISO()) });
    contenedor.appendChild(
      elemento('div', { class: 'banner-entrega-carga' }, [
        elemento('span', { class: 'chip chip--sobre-oscuro', texto: `${finca?.nombre ?? 'Finca'} · ${area?.nombre ?? 'Área'}` }),
        etiquetaFecha,
        elemento('h1', { class: 'banner-entrega-carga__titulo', texto: 'Entrega de Carga' }),
      ])
    );

    // ---- Fecha (editable manualmente; por defecto hoy) ----
    const campoFecha = elemento('input', { type: 'date', id: 'entrega-carga-fecha', value: hoyISO() });
    campoFecha.addEventListener('change', () => {
      if (campoFecha.value) etiquetaFecha.textContent = fechaCorta(campoFecha.value);
    });
    contenedor.appendChild(
      elemento('div', { class: 'campo', style: 'margin-bottom:var(--espacio)' }, [
        elemento('label', { for: 'entrega-carga-fecha', texto: 'Fecha' }),
        campoFecha,
      ])
    );

    // ---- Responsable ----
    let responsableSeleccionado = responsables[0]?.nombre ?? null;
    contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:0.85rem;letter-spacing:0.04em', texto: 'ENTREGAR A' }));
    const filaResponsables = elemento('div', { class: 'fila', style: 'flex-wrap:wrap;gap:8px;margin-bottom:var(--espacio)' });
    function pintarResponsables() {
      filaResponsables.innerHTML = '';
      for (const r of responsables) {
        const boton = elemento('button', {
          type: 'button',
          class: `pestana${responsableSeleccionado === r.nombre ? ' pestana--activa' : ''}`,
          texto: r.nombre,
          onclick: () => {
            responsableSeleccionado = r.nombre;
            marcarSucio(contenedor);
            pintarResponsables();
          },
        });
        const grupo = elemento('div', { class: 'fila', style: 'gap:2px' }, [
          boton,
          esAdmin
            ? elemento('button', {
                type: 'button',
                class: 'boton-icono',
                title: 'Corregir nombre',
                style: 'background:none;color:var(--texto-suave);flex:none;min-width:0;padding:0 4px',
                texto: '✏️',
                onclick: async () => {
                  const nombreAnterior = r.nombre;
                  const editado = await editarResponsable(r);
                  if (!editado) return;
                  r.nombre = editado.nombre;
                  if (responsableSeleccionado === nombreAnterior) responsableSeleccionado = editado.nombre;
                  pintarResponsables();
                },
              })
            : null,
          esAdmin
            ? elemento('button', {
                type: 'button',
                class: 'boton-icono',
                title: 'Eliminar de la lista',
                style: 'background:none;color:var(--rojo-500);flex:none;min-width:0;padding:0 4px',
                texto: '🗑️',
                onclick: async () => {
                  if (!confirm(`¿Eliminar "${r.nombre}" de la lista de "Entregar a"? No se puede deshacer.`)) return;
                  await repos.eliminar('responsables_carga', r.id);
                  responsables.splice(responsables.indexOf(r), 1);
                  if (responsableSeleccionado === r.nombre) responsableSeleccionado = responsables[0]?.nombre ?? null;
                  pintarResponsables();
                },
              })
            : null,
        ]);
        filaResponsables.appendChild(grupo);
      }
      const botonNuevo = elemento('button', {
        type: 'button',
        class: 'pestana',
        style: 'background:none;border-style:dashed',
        texto: '+ Nuevo',
        onclick: async () => {
          const nuevo = await agregarResponsable();
          if (!nuevo) return;
          responsables.push(nuevo);
          responsableSeleccionado = nuevo.nombre;
          pintarResponsables();
        },
      });
      filaResponsables.appendChild(botonNuevo);
    }
    pintarResponsables();
    contenedor.appendChild(filaResponsables);

    // ---- Cajas de primera / segunda ----
    const stepperPrimera = crearStepper('verde', contenedor);
    const stepperSegunda = crearStepper('ambar', contenedor);
    contenedor.appendChild(
      elemento('div', { class: 'tarjeta', style: 'display:flex;flex-direction:column;gap:14px;margin-bottom:var(--espacio)' }, [
        elemento('div', { class: 'fila', style: 'justify-content:space-between;align-items:center' }, [
          elemento('span', { style: 'font-weight:700', texto: 'Cajas de primera' }),
          stepperPrimera.contenedor,
        ]),
        elemento('div', { class: 'fila', style: 'justify-content:space-between;align-items:center' }, [
          elemento('span', { style: 'font-weight:700', texto: 'Cajas de segunda' }),
          stepperSegunda.contenedor,
        ]),
      ])
    );

    // ---- Variedad + observaciones (ej. cuántos dedos/manos trae cada caja) ----
    const campoVariedad = elemento('select', { id: 'entrega-carga-variedad' }, [
      elemento('option', { value: '', texto: '—' }),
      elemento('option', { value: 'Plátano', texto: 'Plátano' }),
      elemento('option', { value: 'Banano', texto: 'Banano' }),
      elemento('option', { value: 'FHIA', texto: 'FHIA' }),
    ]);
    const campoObservaciones = elemento('textarea', {
      id: 'entrega-carga-observaciones',
      rows: '2',
      placeholder: 'Ej: cajas de 18 dedos, manos de 6ta...',
    });
    contenedor.appendChild(
      elemento('div', { class: 'tarjeta', style: 'display:flex;flex-direction:column;gap:14px;margin-bottom:var(--espacio)' }, [
        elemento('div', { class: 'campo', style: 'margin-bottom:0' }, [elemento('label', { for: 'entrega-carga-variedad', texto: 'Variedad' }), campoVariedad]),
        elemento('div', { class: 'campo', style: 'margin-bottom:0' }, [elemento('label', { for: 'entrega-carga-observaciones', texto: 'Observaciones' }), campoObservaciones]),
      ])
    );

    const mensaje = elemento('div', { class: 'mensaje-error mensaje-error--error' });
    contenedor.appendChild(mensaje);

    const botonGuardar = elemento('button', { type: 'button', class: 'boton boton--primario', texto: 'Guardar entrega' });
    botonGuardar.addEventListener('click', async () => {
      mensaje.textContent = '';
      const cajasPrimera = stepperPrimera.obtenerValor();
      const cajasSegunda = stepperSegunda.obtenerValor();
      if (cajasPrimera === 0 && cajasSegunda === 0) {
        mensaje.textContent = 'Marca al menos una caja de primera o de segunda.';
        return;
      }
      if (!responsableSeleccionado) {
        mensaje.textContent = 'Agrega o elige a quién se le entrega.';
        return;
      }
      if (!campoFecha.value) {
        mensaje.textContent = 'Elige la fecha de la entrega.';
        return;
      }
      botonGuardar.disabled = true;
      try {
        const sesion = await auth.sesionActual();
        const grupoEntrega = generarUUID();
        const observaciones = (campoObservaciones.value || '') + (campoVariedad.value ? ` [Variedad: ${campoVariedad.value}]` : '');
        const base = {
          finca_id: contexto.fincaId,
          area_id: contexto.areaId,
          fecha: campoFecha.value,
          cantidad_dedos: 0,
          responsable_id: sesion?.usuario?.id ?? null,
          responsable_nombre: responsableSeleccionado,
          grupo_entrega: grupoEntrega,
          observaciones,
        };
        if (cajasPrimera > 0) await repos.crear('entregas_platano', { ...base, cantidad_cajas: cajasPrimera, calidad: 'primera' });
        if (cajasSegunda > 0) await repos.crear('entregas_platano', { ...base, cantidad_cajas: cajasSegunda, calidad: 'segunda' });
        stepperPrimera.reiniciar();
        stepperSegunda.reiniciar();
        campoVariedad.value = '';
        campoObservaciones.value = '';
        limpiarSucio(contenedor);
        await pintarHoy();
      } catch (error) {
        mensaje.textContent = error.message || 'No se pudo guardar la entrega';
      } finally {
        botonGuardar.disabled = false;
      }
    });
    contenedor.appendChild(botonGuardar);
    contenedor.appendChild(elemento('div', { class: 'espaciador' }));

    // ---- Hoy ----
    const cabeceraHoy = elemento('div', { class: 'fila', style: 'justify-content:space-between;align-items:baseline' }, [
      elemento('h2', { class: 'titulo-pantalla', style: 'font-size:0.85rem;letter-spacing:0.04em', texto: 'HOY' }),
      elemento('span', { class: 'subtitulo-pantalla', id: 'entrega-carga-total' }),
    ]);
    contenedor.appendChild(cabeceraHoy);
    const listaHoy = elemento('div', { class: 'lista-registros' });
    contenedor.appendChild(listaHoy);

    async function pintarHoy() {
      const grupos = await entregasCargaHoy(contexto.fincaId, contexto.areaId);
      const totalPrimera = grupos.reduce((s, g) => s + g.primera, 0);
      const totalSegunda = grupos.reduce((s, g) => s + g.segunda, 0);
      cabeceraHoy.querySelector('#entrega-carga-total').textContent = `${totalPrimera} primera · ${totalSegunda} segunda`;

      listaHoy.innerHTML = '';
      if (grupos.length === 0) {
        listaHoy.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Sin entregas registradas todavía hoy.' }));
        return;
      }
      for (const g of grupos) {
        listaHoy.appendChild(
          elemento('div', { class: 'fila-registro' }, [
            elemento('div', {}, [
              elemento('div', { class: 'fila-registro__titulo', texto: g.responsable }),
              g.observaciones ? elemento('div', { class: 'fila-registro__subtitulo', texto: g.observaciones.trim() }) : null,
            ]),
            elemento('div', { class: 'fila-registro__valor tono-verde', texto: `${g.primera} primera · ${g.segunda} segunda` }),
            esAdmin
              ? elemento('button', {
                  type: 'button',
                  class: 'boton-icono',
                  title: 'Eliminar entrega',
                  style: 'background:none;color:var(--rojo-500);flex:none',
                  texto: '🗑️',
                  onclick: async () => {
                    if (!confirm(`¿Eliminar la entrega a ${g.responsable}? No se puede deshacer.`)) return;
                    for (const id of g.ids) await repos.eliminar('entregas_platano', id);
                    await pintarHoy();
                  },
                })
              : null,
          ])
        );
      }
    }
    await pintarHoy();
  },
};
