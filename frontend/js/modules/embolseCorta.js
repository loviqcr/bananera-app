import { repos } from '../db/repos.js';
import { auth } from './auth.js';
import { elemento, crearFormulario, listaRegistros, mostrarDialogo, tarjetaEstadistica, formatearFecha, hoyISO } from '../ui.js';

// Días típicos entre el embolse de un racimo y su corta (maduración) — se
// usa solo para estimar la fecha de la pestaña "Seguimiento"; no depende de
// ninguna configuración del servidor porque no existe un dato real de
// variedad/clima por área todavía.
const DIAS_MADURACION_CORTA = 84;

function sumarDias(fechaISO, dias) {
  const fecha = new Date(fechaISO + 'T00:00:00');
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** Racimos embolsados/cortados HOY — usado por el dashboard y por este módulo. */
export async function estadisticasDia(fincaId) {
  const hoy = hoyISO();
  const [embolse, corta, proximos] = await Promise.all([
    repos.listarPorFinca('embolse', fincaId),
    repos.listarPorFinca('corta', fincaId),
    proximosACorta(fincaId),
  ]);
  const embolsadoHoy = embolse.filter((f) => f.fecha === hoy).reduce((s, f) => s + Number(f.cantidad || 0), 0);
  const cortadoHoy = corta.filter((f) => f.fecha === hoy).reduce((s, f) => s + Number(f.racimos_cortados || 0), 0);
  return { embolsadoHoy, cortadoHoy, proximosACorta: proximos.length };
}

function inicioSemanaDe(fechaISO) {
  const fecha = new Date(fechaISO + 'T00:00:00');
  const dia = fecha.getDay() === 0 ? 7 : fecha.getDay(); // lunes = 1 ... domingo = 7
  fecha.setDate(fecha.getDate() - (dia - 1));
  return fecha.toISOString().slice(0, 10);
}

/**
 * Desglose de embolse por semana y variedad (Plátano/Banano/FHIA) — para
 * que el administrador lo vea de un vistazo desde Inicio tocando la
 * tarjeta "Embolse hoy". `fincaId` es el mismo contexto de Inicio: 'todas'
 * suma todas las fincas, una finca específica solo la de ella. `semanas`
 * limita cuántas semanas recientes devolver (más recientes primero).
 */
export async function resumenEmbolsePorSemana(fincaId, semanas = 8) {
  const todas = await repos.listarPorFinca('embolse', fincaId);
  const porSemana = new Map();
  for (const f of todas) {
    const semana = inicioSemanaDe(f.fecha);
    const variedad = separarVariedad(f.observaciones).variedad || 'Sin variedad';
    const actual = porSemana.get(semana) ?? { semana, Plátano: 0, Banano: 0, FHIA: 0, 'Sin variedad': 0 };
    actual[variedad] = (actual[variedad] ?? 0) + (Number(f.cantidad) || 0);
    porSemana.set(semana, actual);
  }
  return Array.from(porSemana.values())
    .sort((a, b) => (a.semana < b.semana ? 1 : -1))
    .slice(0, semanas);
}

/**
 * Áreas embolsadas que todavía no tienen una corta posterior registrada —
 * es decir, racimos que probablemente sigan en la mata. Se ordenan por
 * fecha estimada de corta (embolse + tiempo de maduración) más próxima
 * primero.
 */
export async function proximosACorta(fincaId) {
  const [embolseFilas, cortaFilas] = await Promise.all([
    repos.listarPorFinca('embolse', fincaId),
    repos.listarPorFinca('corta', fincaId),
  ]);
  const ultimaCortaPorArea = {};
  for (const c of cortaFilas) {
    if (!ultimaCortaPorArea[c.area_id] || c.fecha > ultimaCortaPorArea[c.area_id]) ultimaCortaPorArea[c.area_id] = c.fecha;
  }
  return embolseFilas
    .filter((e) => !ultimaCortaPorArea[e.area_id] || e.fecha > ultimaCortaPorArea[e.area_id])
    .map((e) => ({ ...e, fechaEstimadaCorta: sumarDias(e.fecha, DIAS_MADURACION_CORTA) }))
    .sort((a, b) => (a.fechaEstimadaCorta < b.fechaEstimadaCorta ? -1 : 1));
}

async function esAdministrador() {
  const sesion = await auth.sesionActual();
  return sesion?.usuario?.rol === 'administrador';
}

async function opcionesAreas(fincaId) {
  const areas = fincaId && fincaId !== 'todas' ? await repos.listarPorFinca('areas', fincaId) : [];
  return areas.sort((a, b) => a.orden - b.orden).map((a) => ({ value: a.id, label: a.nombre }));
}

async function opcionesColores() {
  const colores = await repos.listarTodos('colores_cinta');
  return colores.filter((c) => c.activo).map((c) => ({ value: c.id, label: c.nombre }));
}

async function agregarColor() {
  const nombre = prompt('Nombre del nuevo color de cinta:');
  if (!nombre || !nombre.trim()) return null;
  return repos.crear('colores_cinta', { nombre: nombre.trim(), activo: true });
}

// La "variedad" acá es directamente Plátano/Banano/FHIA — no un catálogo
// de cultivares con nombre propio (eso es aparte, en Producción).
const OPCIONES_VARIEDAD = [
  { value: 'Plátano', label: 'Plátano' },
  { value: 'Banano', label: 'Banano' },
  { value: 'FHIA', label: 'FHIA' },
];

// La variedad se guarda como una etiqueta [Variedad: X] dentro del mismo
// campo de observaciones (no tiene columna propia) — estas dos funciones
// la separan del resto del texto para poder editarlas por separado, y
// la vuelven a unir al guardar.
function separarVariedad(observaciones) {
  const match = /\[Variedad: ([^\]]+)\]/.exec(observaciones || '');
  const limpio = (observaciones || '').replace(/\s*\[Variedad: [^\]]+\]/, '').trim();
  return { variedad: match ? match[1] : '', limpio };
}

function unirVariedad(limpio, variedad) {
  return (limpio || '') + (variedad ? ` [Variedad: ${variedad}]` : '');
}

async function renderizarEmbolse(contenedor, contexto) {
  contenedor.innerHTML = '';
  const [areas, colores, filas, esAdmin] = await Promise.all([
    opcionesAreas(contexto.fincaId),
    opcionesColores(),
    repos.listarPorFinca('embolse', contexto.fincaId),
    esAdministrador(),
  ]);
  const ordenadas = filas.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const nombreColor = Object.fromEntries((await repos.listarTodos('colores_cinta')).map((c) => [c.id, c.nombre]));
  const nombreArea = Object.fromEntries((await repos.listarTodos('areas')).map((a) => [a.id, a.nombre]));

  if (contexto.fincaId !== 'todas') {
    const form = crearFormulario({
      textoBoton: '🎗️ Registrar embolse',
      campos: [
        { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', requerido: true, valor: hoyISO() },
        { nombre: 'area_id', etiqueta: 'Área', tipo: 'select', requerido: true, opciones: areas },
        { nombre: 'cantidad', etiqueta: 'Cantidad', tipo: 'number', requerido: true },
        { nombre: 'color_cinta_id', etiqueta: 'Color de cinta', tipo: 'select', opciones: colores },
        { nombre: 'variedad', etiqueta: 'Variedad', tipo: 'select', opciones: OPCIONES_VARIEDAD },
        { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea' },
      ],
      alGuardar: async (valores) => {
        const sesion = await auth.sesionActual();
        await repos.crear('embolse', {
          finca_id: contexto.fincaId,
          area_id: valores.area_id || null,
          fecha: valores.fecha,
          cantidad: Number(valores.cantidad) || 0,
          color_cinta_id: valores.color_cinta_id || null,
          responsable_id: sesion?.usuario?.id ?? null,
          observaciones: (valores.observaciones || '') + (valores.variedad ? ` [Variedad: ${valores.variedad}]` : ''),
        });
        await renderizarEmbolse(contenedor, contexto);
      },
    });
    contenedor.appendChild(form);
    const botonColor = elemento('button', { type: 'button', class: 'boton boton--fantasma', texto: '+ Nuevo color de cinta' });
    botonColor.addEventListener('click', async () => {
      const nuevo = await agregarColor();
      if (nuevo) await renderizarEmbolse(contenedor, contexto);
    });
    contenedor.appendChild(botonColor);
    contenedor.appendChild(elemento('div', { class: 'espaciador' }));
  }

  contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Embolse por área' }));
  contenedor.appendChild(
    listaRegistros(
      ordenadas.slice(0, 15),
      (f) => ({
        titulo: `${formatearFecha(f.fecha)} · ${nombreArea[f.area_id] ?? 'Área'}`,
        subtitulo: f.color_cinta_id ? `Cinta ${nombreColor[f.color_cinta_id] ?? ''}` : '',
        valor: f.cantidad,
      }),
      {
        onEditar: esAdmin
          ? async (f) => {
              const { variedad, limpio } = separarVariedad(f.observaciones);
              const resultado = await mostrarDialogo({
                titulo: 'Editar embolse',
                textoConfirmar: 'Guardar',
                campos: [
                  { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', valor: f.fecha },
                  { nombre: 'area_id', etiqueta: 'Área', tipo: 'select', opciones: areas, valor: f.area_id || '' },
                  { nombre: 'cantidad', etiqueta: 'Cantidad', tipo: 'number', valor: f.cantidad },
                  { nombre: 'color_cinta_id', etiqueta: 'Color de cinta', tipo: 'select', opciones: colores, valor: f.color_cinta_id || '' },
                  { nombre: 'variedad', etiqueta: 'Variedad', tipo: 'select', opciones: OPCIONES_VARIEDAD, valor: variedad },
                  { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea', valor: limpio },
                ],
              });
              if (!resultado) return;
              await repos.editar('embolse', f.id, {
                fecha: resultado.fecha,
                area_id: resultado.area_id || null,
                cantidad: Number(resultado.cantidad) || 0,
                color_cinta_id: resultado.color_cinta_id || null,
                observaciones: unirVariedad(resultado.observaciones, resultado.variedad),
              });
              await renderizarEmbolse(contenedor, contexto);
            }
          : undefined,
        onEliminar: esAdmin
          ? async (f) => {
              await repos.eliminar('embolse', f.id);
              await renderizarEmbolse(contenedor, contexto);
            }
          : undefined,
      }
    )
  );
}

async function renderizarCorta(contenedor, contexto) {
  contenedor.innerHTML = '';
  const [areas, filas, esAdmin] = await Promise.all([
    opcionesAreas(contexto.fincaId),
    repos.listarPorFinca('corta', contexto.fincaId),
    esAdministrador(),
  ]);
  const ordenadas = filas.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const nombreArea = Object.fromEntries((await repos.listarTodos('areas')).map((a) => [a.id, a.nombre]));

  const totalRacimos = filas.reduce((s, f) => s + Number(f.racimos_cortados || 0), 0);
  const areasUnicas = new Set(filas.map((f) => f.area_id)).size;
  const rendimiento = areasUnicas > 0 ? (totalRacimos / areasUnicas).toFixed(1) : '0';

  contenedor.appendChild(
    elemento('div', { class: 'rejilla-estadisticas' }, [
      elemento('div', { class: 'tarjeta estadistica' }, [elemento('div', { class: 'estadistica__valor', texto: totalRacimos.toLocaleString('es-CR') }), elemento('div', { class: 'estadistica__etiqueta', texto: 'Racimos cortados' })]),
      elemento('div', { class: 'tarjeta estadistica' }, [elemento('div', { class: 'estadistica__valor', texto: String(areasUnicas) }), elemento('div', { class: 'estadistica__etiqueta', texto: 'Áreas con corta' })]),
      elemento('div', { class: 'tarjeta estadistica' }, [elemento('div', { class: 'estadistica__valor', texto: rendimiento }), elemento('div', { class: 'estadistica__etiqueta', texto: 'Racimos / área' })]),
    ])
  );

  if (contexto.fincaId !== 'todas') {
    const form = crearFormulario({
      textoBoton: '✂️ Registrar corta',
      campos: [
        { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', requerido: true, valor: hoyISO() },
        { nombre: 'area_id', etiqueta: 'Área', tipo: 'select', requerido: true, opciones: areas },
        { nombre: 'racimos_cortados', etiqueta: 'Racimos cortados', tipo: 'number', requerido: true },
        { nombre: 'variedad', etiqueta: 'Variedad', tipo: 'select', opciones: OPCIONES_VARIEDAD },
        { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea' },
      ],
      alGuardar: async (valores) => {
        const sesion = await auth.sesionActual();
        await repos.crear('corta', {
          finca_id: contexto.fincaId,
          area_id: valores.area_id || null,
          fecha: valores.fecha,
          racimos_cortados: Number(valores.racimos_cortados) || 0,
          responsable_id: sesion?.usuario?.id ?? null,
          observaciones: (valores.observaciones || '') + (valores.variedad ? ` [Variedad: ${valores.variedad}]` : ''),
        });
        await renderizarCorta(contenedor, contexto);
      },
    });
    contenedor.appendChild(form);
  }

  contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Cortas registradas' }));
  contenedor.appendChild(
    listaRegistros(
      ordenadas.slice(0, 15),
      (f) => ({
        titulo: `${formatearFecha(f.fecha)} · ${nombreArea[f.area_id] ?? 'Área'}`,
        valor: `${f.racimos_cortados} rac.`,
      }),
      {
        onEditar: esAdmin
          ? async (f) => {
              const { variedad, limpio } = separarVariedad(f.observaciones);
              const resultado = await mostrarDialogo({
                titulo: 'Editar corta',
                textoConfirmar: 'Guardar',
                campos: [
                  { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', valor: f.fecha },
                  { nombre: 'area_id', etiqueta: 'Área', tipo: 'select', opciones: areas, valor: f.area_id || '' },
                  { nombre: 'racimos_cortados', etiqueta: 'Racimos cortados', tipo: 'number', valor: f.racimos_cortados },
                  { nombre: 'variedad', etiqueta: 'Variedad', tipo: 'select', opciones: OPCIONES_VARIEDAD, valor: variedad },
                  { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea', valor: limpio },
                ],
              });
              if (!resultado) return;
              await repos.editar('corta', f.id, {
                fecha: resultado.fecha,
                area_id: resultado.area_id || null,
                racimos_cortados: Number(resultado.racimos_cortados) || 0,
                observaciones: unirVariedad(resultado.observaciones, resultado.variedad),
              });
              await renderizarCorta(contenedor, contexto);
            }
          : undefined,
        onEliminar: esAdmin
          ? async (f) => {
              await repos.eliminar('corta', f.id);
              await renderizarCorta(contenedor, contexto);
            }
          : undefined,
      }
    )
  );
}

async function renderizarSeguimiento(contenedor, contexto) {
  contenedor.innerHTML = '';
  const pendientes = await proximosACorta(contexto.fincaId);
  const nombreArea = Object.fromEntries((await repos.listarTodos('areas')).map((a) => [a.id, a.nombre]));
  const nombreFinca = Object.fromEntries((await repos.listarTodos('fincas')).map((f) => [f.id, f.nombre]));

  contenedor.appendChild(
    elemento('p', { class: 'subtitulo-pantalla' }, `Áreas embolsadas sin corta registrada todavía, con fecha estimada de corta (maduración de ~${DIAS_MADURACION_CORTA} días).`)
  );
  contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Próximos a corta' }));
  contenedor.appendChild(
    listaRegistros(
      pendientes.slice(0, 20),
      (f) => ({
        titulo: `${contexto.fincaId === 'todas' ? `${nombreFinca[f.finca_id] ?? 'Finca'} · ` : ''}${nombreArea[f.area_id] ?? 'Área'}`,
        subtitulo: `${f.cantidad} racimos · estimado ${formatearFecha(f.fechaEstimadaCorta)}`,
        valor: f.fechaEstimadaCorta < hoyISO() ? 'Vencido' : null,
        tono: 'tono-alerta',
      }),
      { vacioTexto: 'No hay áreas embolsadas pendientes de corta.' }
    )
  );
}

// Se recuerda fuera de render() porque cada ~30s, al terminar de
// sincronizar en segundo plano, app.js vuelve a llamar render() para
// refrescar los datos — sin esto, ese refresco automático regresaba
// siempre a la primera pestaña aunque el usuario estuviera en otra.
let pestanaGuardada = 'embolse';

export const embolseCortaModulo = {
  etiqueta: 'Embolse / Corta',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const dia = await estadisticasDia(contexto.fincaId);
    contenedor.appendChild(
      elemento('div', { class: 'rejilla-estadisticas' }, [
        tarjetaEstadistica(dia.embolsadoHoy.toLocaleString('es-CR'), 'Embolsado hoy'),
        tarjetaEstadistica(dia.proximosACorta, 'Próximos a corta', dia.proximosACorta > 0 ? 'estadistica--pendiente' : ''),
        tarjetaEstadistica(dia.cortadoHoy.toLocaleString('es-CR'), 'Cortados hoy'),
      ])
    );

    const pestanas = elemento('div', { class: 'pestanas' });
    const zona = elemento('div');
    contenedor.appendChild(pestanas);
    contenedor.appendChild(zona);

    const tabs = [
      { clave: 'embolse', etiqueta: '🎗️ Embolse', render: renderizarEmbolse },
      { clave: 'corta', etiqueta: '✂️ Corta', render: renderizarCorta },
      { clave: 'seguimiento', etiqueta: '📍 Seguimiento', render: renderizarSeguimiento },
    ];
    async function activar(clave) {
      pestanaGuardada = clave;
      for (const boton of pestanas.children) boton.classList.toggle('pestana--activa', boton.dataset.clave === clave);
      const tab = tabs.find((t) => t.clave === clave);
      await tab.render(zona, contexto);
    }
    for (const tab of tabs) {
      const boton = elemento('button', { type: 'button', class: 'pestana', 'data-clave': tab.clave, texto: tab.etiqueta });
      boton.addEventListener('click', () => activar(tab.clave));
      pestanas.appendChild(boton);
    }
    await activar(tabs.some((t) => t.clave === pestanaGuardada) ? pestanaGuardada : tabs[0].clave);
  },
};
