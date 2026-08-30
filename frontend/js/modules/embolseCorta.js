import { repos } from '../db/repos.js';
import { auth } from './auth.js';
import { elemento, crearFormulario, listaRegistros, formatearFecha, hoyISO } from '../ui.js';

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

async function renderizarEmbolse(contenedor, contexto) {
  contenedor.innerHTML = '';
  const [areas, colores, filas] = await Promise.all([opcionesAreas(contexto.fincaId), opcionesColores(), repos.listarPorFinca('embolse', contexto.fincaId)]);
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
          observaciones: valores.observaciones || null,
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
    listaRegistros(ordenadas.slice(0, 15), (f) => ({
      titulo: `${formatearFecha(f.fecha)} · ${nombreArea[f.area_id] ?? 'Área'}`,
      subtitulo: f.color_cinta_id ? `Cinta ${nombreColor[f.color_cinta_id] ?? ''}` : '',
      valor: f.cantidad,
    }))
  );
}

async function renderizarCorta(contenedor, contexto) {
  contenedor.innerHTML = '';
  const [areas, filas] = await Promise.all([opcionesAreas(contexto.fincaId), repos.listarPorFinca('corta', contexto.fincaId)]);
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
          observaciones: valores.observaciones || null,
        });
        await renderizarCorta(contenedor, contexto);
      },
    });
    contenedor.appendChild(form);
  }

  contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Cortas registradas' }));
  contenedor.appendChild(
    listaRegistros(ordenadas.slice(0, 15), (f) => ({
      titulo: `${formatearFecha(f.fecha)} · ${nombreArea[f.area_id] ?? 'Área'}`,
      valor: `${f.racimos_cortados} rac.`,
    }))
  );
}

export const embolseCortaModulo = {
  etiqueta: 'Embolse / Corta',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const pestanas = elemento('div', { class: 'pestanas' });
    const zona = elemento('div');
    contenedor.appendChild(pestanas);
    contenedor.appendChild(zona);

    const tabs = [
      { clave: 'embolse', etiqueta: '🎗️ Embolse', render: renderizarEmbolse },
      { clave: 'corta', etiqueta: '✂️ Corta', render: renderizarCorta },
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
    await activar('embolse');
  },
};
