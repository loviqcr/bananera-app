import { repos } from '../db/repos.js';
import { localdb, generarUUID } from '../db/localdb.js';
import { auth } from './auth.js';
import { elemento, hoyISO } from '../ui.js';

async function opcionesResponsables() {
  const todos = await repos.listarTodos('responsables_carga');
  return todos.filter((r) => r.activo).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

async function agregarResponsable() {
  const nombre = prompt('¿A quién se le entrega? (nombre del transportista/comprador):');
  if (!nombre || !nombre.trim()) return null;
  return repos.crear('responsables_carga', { nombre: nombre.trim(), activo: true });
}

function fechaCorta(fechaISO) {
  const fecha = new Date(fechaISO + 'T00:00:00');
  const texto = fecha.toLocaleDateString('es-CR', { weekday: 'short', day: 'numeric', month: 'short' });
  return texto.charAt(0).toUpperCase() + texto.slice(1).replace('.', '');
}

/** Control +/- reutilizado para Cajas de primera/segunda. */
function crearStepper(colorBoton) {
  let valor = 0;
  const etiquetaValor = elemento('strong', { class: 'stepper__valor', texto: '0' });
  const botonMenos = elemento('button', {
    type: 'button',
    class: 'boton-stepper',
    texto: '−',
    onclick: () => {
      valor = Math.max(0, valor - 1);
      etiquetaValor.textContent = String(valor);
    },
  });
  const botonMas = elemento('button', {
    type: 'button',
    class: `boton-stepper boton-stepper--${colorBoton}`,
    texto: '+',
    onclick: () => {
      valor += 1;
      etiquetaValor.textContent = String(valor);
    },
  });
  const contenedor = elemento('div', { class: 'stepper' }, [botonMenos, etiquetaValor, botonMas]);
  return {
    contenedor,
    obtenerValor: () => valor,
    reiniciar: () => {
      valor = 0;
      etiquetaValor.textContent = '0';
    },
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
      actualizadoEn: fila.updated_at,
    };
    grupo[fila.calidad] += Number(fila.cantidad_cajas) || 0;
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

    const [fincas, areas, responsables] = await Promise.all([
      repos.listarTodos('fincas'),
      repos.listarPorFinca('areas', contexto.fincaId),
      opcionesResponsables(),
    ]);
    const finca = fincas.find((f) => f.id === contexto.fincaId);
    const area = areas.find((a) => a.id === contexto.areaId);

    // ---- Banner de contexto (finca · área + fecha) ----
    contenedor.appendChild(
      elemento('div', { class: 'banner-entrega-carga' }, [
        elemento('span', { class: 'chip chip--sobre-oscuro', texto: `${finca?.nombre ?? 'Finca'} · ${area?.nombre ?? 'Área'}` }),
        elemento('span', { class: 'banner-entrega-carga__fecha', texto: fechaCorta(hoyISO()) }),
        elemento('h1', { class: 'banner-entrega-carga__titulo', texto: 'Entrega de Carga' }),
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
            pintarResponsables();
          },
        });
        filaResponsables.appendChild(boton);
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
    const stepperPrimera = crearStepper('verde');
    const stepperSegunda = crearStepper('ambar');
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
      botonGuardar.disabled = true;
      try {
        const sesion = await auth.sesionActual();
        const grupoEntrega = generarUUID();
        const base = {
          finca_id: contexto.fincaId,
          area_id: contexto.areaId,
          fecha: hoyISO(),
          cantidad_dedos: 0,
          responsable_id: sesion?.usuario?.id ?? null,
          responsable_nombre: responsableSeleccionado,
          grupo_entrega: grupoEntrega,
        };
        if (cajasPrimera > 0) await repos.crear('entregas_platano', { ...base, cantidad_cajas: cajasPrimera, calidad: 'primera' });
        if (cajasSegunda > 0) await repos.crear('entregas_platano', { ...base, cantidad_cajas: cajasSegunda, calidad: 'segunda' });
        stepperPrimera.reiniciar();
        stepperSegunda.reiniciar();
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
            elemento('div', { class: 'fila-registro__titulo', texto: g.responsable }),
            elemento('div', { class: 'fila-registro__valor tono-verde', texto: `${g.primera} primera · ${g.segunda} segunda` }),
          ])
        );
      }
    }
    await pintarHoy();
  },
};
