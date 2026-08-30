import { repos } from '../db/repos.js';
import { auth } from './auth.js';
import { elemento, crearFormulario, tarjetaEstadistica, listaRegistros, formatearFecha, hoyISO } from '../ui.js';

const FRECUENCIA_DEFECTO = { deshija: 45, dermaticida: 120, fertilizacion: 22 };

async function opcionesAreas(fincaId) {
  const areas = fincaId && fincaId !== 'todas' ? await repos.listarPorFinca('areas', fincaId) : [];
  return areas.sort((a, b) => a.orden - b.orden).map((a) => ({ value: a.id, label: a.nombre }));
}

export async function obtenerFrecuenciaDias(tipoLabor) {
  const config = await repos.listarTodos('configuracion_frecuencias');
  const fila = config.find((c) => c.tipo_labor === tipoLabor);
  return fila ? Number(fila.dias) : FRECUENCIA_DEFECTO[tipoLabor];
}

function sumarDias(fechaISO, dias) {
  const fecha = new Date(fechaISO + 'T00:00:00');
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

function estadoProximaFecha(proximaFechaISO) {
  if (!proximaFechaISO) return null;
  const hoy = hoyISO();
  const enSieteDias = sumarDias(hoy, 7);
  if (proximaFechaISO < hoy) return { texto: '🔴 Atrasada', clase: 'insignia--rojo' };
  if (proximaFechaISO <= enSieteDias) return { texto: '🟡 Próxima', clase: 'insignia--ambar' };
  return { texto: '🟢 Programada', clase: 'insignia--verde' };
}

/** Usado también por calendario.js y el dashboard para las alertas de labores. */
export async function laboresConEstado(fincaId) {
  const tablas = ['labores_deshija', 'labores_dermaticida', 'labores_fertilizacion'];
  const resultado = [];
  for (const tabla of tablas) {
    const filas = await repos.listarPorFinca(tabla, fincaId);
    for (const fila of filas) {
      resultado.push({ ...fila, tabla, estado: estadoProximaFecha(fila.proxima_fecha) });
    }
  }
  return resultado;
}

function formularioSimple(nombre, fincaId, extraCampos, alGuardarExtra) {
  return crearFormulario({
    textoBoton: 'Guardar',
    campos: extraCampos,
    alGuardar: async (valores) => {
      const sesion = await auth.sesionActual();
      await alGuardarExtra(valores, sesion);
    },
  });
}

async function renderizarSiembra(contenedor, contexto) {
  contenedor.innerHTML = '';
  const [areas, filas] = await Promise.all([opcionesAreas(contexto.fincaId), repos.listarPorFinca('labores_siembra', contexto.fincaId)]);
  const ordenadas = filas.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

  if (contexto.fincaId !== 'todas') {
    const form = crearFormulario({
      textoBoton: '🌱 Registrar siembra',
      campos: [
        { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', requerido: true, valor: hoyISO() },
        { nombre: 'area_id', etiqueta: 'Área', tipo: 'select', requerido: true, opciones: areas },
        { nombre: 'nombre', etiqueta: 'Nombre / referencia', tipo: 'text' },
        { nombre: 'cantidad', etiqueta: 'Cantidad sembrada', tipo: 'number', paso: '0.01' },
        { nombre: 'variedad', etiqueta: 'Variedad', tipo: 'text' },
        { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea' },
      ],
      alGuardar: async (valores) => {
        const sesion = await auth.sesionActual();
        await repos.crear('labores_siembra', {
          finca_id: contexto.fincaId,
          area_id: valores.area_id || null,
          fecha: valores.fecha,
          nombre: valores.nombre || null,
          cantidad: valores.cantidad ? Number(valores.cantidad) : null,
          variedad_id: null,
          responsable_id: sesion?.usuario?.id ?? null,
          observaciones: (valores.observaciones || '') + (valores.variedad ? ` [Variedad: ${valores.variedad}]` : ''),
        });
        await renderizarSiembra(contenedor, contexto);
      },
    });
    contenedor.appendChild(form);
  }

  contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Siembras registradas' }));
  contenedor.appendChild(
    listaRegistros(ordenadas.slice(0, 15), (f) => ({
      titulo: `${formatearFecha(f.fecha)} · ${f.nombre || 'Siembra'}`,
      subtitulo: f.cantidad ? `Cantidad: ${f.cantidad}` : '',
    }))
  );
}

function renderizarLaborConFrecuencia(tabla, tipoLabor, etiquetaAccion, camposExtra, mapearDatos) {
  return async function render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const [areas, filas, dias] = await Promise.all([
      opcionesAreas(contexto.fincaId),
      repos.listarPorFinca(tabla, contexto.fincaId),
      obtenerFrecuenciaDias(tipoLabor),
    ]);
    const ordenadas = filas.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

    contenedor.appendChild(
      elemento('p', { class: 'subtitulo-pantalla' }, `Frecuencia configurada: cada ${dias} días. La próxima fecha se calcula sola al guardar.`)
    );

    if (contexto.fincaId !== 'todas') {
      const form = crearFormulario({
        textoBoton: etiquetaAccion,
        campos: [
          { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', requerido: true, valor: hoyISO() },
          { nombre: 'area_id', etiqueta: 'Área', tipo: 'select', requerido: true, opciones: areas },
          ...camposExtra,
          { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea' },
        ],
        alGuardar: async (valores) => {
          const sesion = await auth.sesionActual();
          const proximaFecha = sumarDias(valores.fecha, dias);
          await repos.crear(tabla, {
            finca_id: contexto.fincaId,
            area_id: valores.area_id || null,
            fecha: valores.fecha,
            proxima_fecha: proximaFecha,
            responsable_id: sesion?.usuario?.id ?? null,
            observaciones: valores.observaciones || null,
            ...mapearDatos(valores),
          });
          await render(contenedor, contexto);
        },
      });
      contenedor.appendChild(form);
    }

    contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Historial' }));
    contenedor.appendChild(
      listaRegistros(
        ordenadas.slice(0, 15),
        (f) => {
          const estado = estadoProximaFecha(f.proxima_fecha);
          return {
            titulo: `${formatearFecha(f.fecha)}`,
            subtitulo: `Próxima: ${formatearFecha(f.proxima_fecha)}`,
            valor: estado?.texto,
            tono: estado?.clase === 'insignia--rojo' ? 'tono-alerta' : estado?.clase === 'insignia--ambar' ? 'tono-ambar' : 'tono-verde',
          };
        },
        'Sin registros todavía.'
      )
    );
  };
}

const renderizarDeshija = renderizarLaborConFrecuencia('labores_deshija', 'deshija', '🌱 Registrar deshija', [], () => ({}));

const renderizarDermaticida = renderizarLaborConFrecuencia(
  'labores_dermaticida',
  'dermaticida',
  '🧪 Registrar aplicación de dermaticida',
  [
    { nombre: 'producto', etiqueta: 'Producto aplicado', tipo: 'text', requerido: true },
    { nombre: 'cantidad', etiqueta: 'Cantidad', tipo: 'number', paso: '0.01' },
    { nombre: 'unidad', etiqueta: 'Unidad', tipo: 'text' },
  ],
  (valores) => ({ producto: valores.producto, cantidad: valores.cantidad ? Number(valores.cantidad) : null, unidad: valores.unidad || null })
);

const renderizarFertilizacion = renderizarLaborConFrecuencia(
  'labores_fertilizacion',
  'fertilizacion',
  '🧪 Registrar fertilización',
  [
    { nombre: 'formula', etiqueta: 'Fórmula', tipo: 'text', requerido: true },
    { nombre: 'cantidad', etiqueta: 'Cantidad', tipo: 'number', paso: '0.01' },
    { nombre: 'unidad', etiqueta: 'Unidad', tipo: 'text' },
  ],
  (valores) => ({ formula: valores.formula, cantidad: valores.cantidad ? Number(valores.cantidad) : null, unidad: valores.unidad || null })
);

export const laboresModulo = {
  etiqueta: 'Labores',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const pestanas = elemento('div', { class: 'pestanas' });
    const zona = elemento('div');
    contenedor.appendChild(pestanas);
    contenedor.appendChild(zona);

    const tabs = [
      { clave: 'siembra', etiqueta: '🌱 Siembra', render: renderizarSiembra },
      { clave: 'deshija', etiqueta: '✂️ Deshija', render: renderizarDeshija },
      { clave: 'dermaticida', etiqueta: '🧪 Dermaticida', render: renderizarDermaticida },
      { clave: 'fertilizacion', etiqueta: '🧪 Fertilización', render: renderizarFertilizacion },
    ];

    async function activar(clave) {
      for (const boton of pestanas.children) boton.classList.toggle('pestana--activa', boton.dataset.clave === clave);
      const tab = tabs.find((t) => t.clave === clave);
      await tab.render(zona, contexto);
    }

    for (const tab of tabs) {
      const boton = elemento('button', { type: 'button', class: 'pestana', 'data-clave': tab.clave, texto: tab.etiqueta });
      boton.addEventListener('click', () => activar(tab.clave));
      pestanas.appendChild(boton);
    }

    await activar('siembra');
  },
};
