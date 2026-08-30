import { repos } from '../db/repos.js';
import { localdb } from '../db/localdb.js';
import { auth } from './auth.js';
import { elemento, crearFormulario, tarjetaEstadistica, listaRegistros, formatearFecha, hoyISO } from '../ui.js';

const ETIQUETA_CALIDAD = { primera: 'Primera', segunda: 'Segunda' };

async function opcionesAreas(fincaId) {
  const areas = fincaId && fincaId !== 'todas' ? await repos.listarPorFinca('areas', fincaId) : [];
  return areas.sort((a, b) => a.orden - b.orden).map((a) => ({ value: a.id, label: a.nombre }));
}

async function opcionesVariedades(tipo) {
  const todas = await repos.listarTodos('variedades');
  return todas.filter((v) => v.tipo === tipo).map((v) => ({ value: v.id, label: v.nombre }));
}

function dentroDeRango(fechaISO, desdeISO) {
  return fechaISO >= desdeISO;
}

function inicioSemanaISO() {
  const hoy = new Date();
  const dia = hoy.getDay() === 0 ? 7 : hoy.getDay(); // lunes = 1 ... domingo = 7
  hoy.setDate(hoy.getDate() - (dia - 1));
  return hoy.toISOString().slice(0, 10);
}

function inicioMesISO() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
}

async function agregarVariedad(tipo) {
  const nombre = prompt(`Nombre de la nueva variedad de ${tipo === 'platano' ? 'plátano' : 'banano'}:`);
  if (!nombre || !nombre.trim()) return null;
  return repos.crear('variedades', { nombre: nombre.trim(), tipo });
}

function calcularEstadisticas(filas, campoCantidad) {
  const hoy = hoyISO();
  const semana = inicioSemanaISO();
  const mes = inicioMesISO();
  let dia = 0, sem = 0, mesTotal = 0;
  const porVariedad = {};
  const porCalidad = { primera: 0, segunda: 0 };

  for (const fila of filas) {
    const cantidad = Number(fila[campoCantidad]) || 0;
    if (fila.fecha === hoy) dia += cantidad;
    if (dentroDeRango(fila.fecha, semana)) sem += cantidad;
    if (dentroDeRango(fila.fecha, mes)) mesTotal += cantidad;
    if (fila.calidad) porCalidad[fila.calidad] = (porCalidad[fila.calidad] ?? 0) + cantidad;
  }
  return { dia, sem, mesTotal, porCalidad };
}

async function renderizarPlatano(contenedor, contexto) {
  contenedor.innerHTML = '';
  const [areas, variedades, todas] = await Promise.all([
    opcionesAreas(contexto.fincaId),
    opcionesVariedades('platano'),
    repos.listarPorFinca('entregas_platano', contexto.fincaId),
  ]);
  const filas = todas.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const stats = calcularEstadisticas(filas, 'cantidad_dedos');

  const rejilla = elemento('div', { class: 'rejilla-estadisticas' }, [
    tarjetaEstadistica(stats.dia.toLocaleString('es-CR'), 'Dedos hoy'),
    tarjetaEstadistica(stats.sem.toLocaleString('es-CR'), 'Dedos esta semana'),
    tarjetaEstadistica(stats.mesTotal.toLocaleString('es-CR'), 'Dedos este mes'),
    tarjetaEstadistica(filas.length, 'Entregas registradas'),
  ]);
  contenedor.appendChild(rejilla);

  if (contexto.fincaId === 'todas') {
    contenedor.appendChild(
      elemento('p', { class: 'subtitulo-pantalla' }, 'Selecciona una finca específica para registrar una entrega nueva (estás viendo el consolidado de todas).')
    );
  } else {
    const form = crearFormulario({
      textoBoton: '🍌 Registrar entrega de plátano',
      campos: [
        { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', requerido: true, valor: hoyISO() },
        { nombre: 'area_id', etiqueta: 'Área', tipo: 'select', requerido: true, opciones: areas },
        { nombre: 'variedad_id', etiqueta: 'Variedad', tipo: 'select', opciones: variedades },
        { nombre: 'calidad', etiqueta: 'Calidad', tipo: 'select', requerido: true, opciones: [{ value: 'primera', label: 'Primera' }, { value: 'segunda', label: 'Segunda' }] },
        { nombre: 'cantidad_cajas', etiqueta: 'Cantidad de cajas', tipo: 'number', paso: '0.01' },
        { nombre: 'cantidad_dedos', etiqueta: 'Cantidad de dedos', tipo: 'number', requerido: true },
        { nombre: 'sistema_racimo', etiqueta: 'Sistema de racimo', tipo: 'text' },
        { nombre: 'cantidad_racimos', etiqueta: 'Cantidad de racimos', tipo: 'number' },
        { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea' },
      ],
      alGuardar: async (valores) => {
        const sesion = await auth.sesionActual();
        await repos.crear('entregas_platano', {
          finca_id: contexto.fincaId,
          area_id: valores.area_id || null,
          fecha: valores.fecha,
          cantidad_cajas: valores.cantidad_cajas ? Number(valores.cantidad_cajas) : 0,
          cantidad_dedos: Number(valores.cantidad_dedos) || 0,
          calidad: valores.calidad,
          variedad_id: valores.variedad_id || null,
          sistema_racimo: valores.sistema_racimo || null,
          cantidad_racimos: valores.cantidad_racimos ? Number(valores.cantidad_racimos) : null,
          responsable_id: sesion?.usuario?.id ?? null,
          observaciones: valores.observaciones || null,
        });
        await renderizarPlatano(contenedor, contexto);
      },
    });

    const filaBotonVariedad = elemento('button', { type: 'button', class: 'boton boton--fantasma', texto: '+ Nueva variedad de plátano' });
    filaBotonVariedad.addEventListener('click', async () => {
      const nueva = await agregarVariedad('platano');
      if (nueva) await renderizarPlatano(contenedor, contexto);
    });

    contenedor.appendChild(form);
    contenedor.appendChild(filaBotonVariedad);
    contenedor.appendChild(elemento('div', { class: 'espaciador' }));
  }

  contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Entregas recientes' }));
  contenedor.appendChild(
    listaRegistros(filas.slice(0, 15), (f) => ({
      titulo: `${formatearFecha(f.fecha)} · ${(f.cantidad_dedos || 0).toLocaleString('es-CR')} dedos`,
      subtitulo: `${ETIQUETA_CALIDAD[f.calidad] ?? f.calidad ?? ''}${f.cantidad_cajas ? ` · ${f.cantidad_cajas} cajas` : ''}`,
      valor: f.cantidad_racimos ? `${f.cantidad_racimos} rac.` : null,
    }))
  );
}

async function renderizarBanano(contenedor, contexto) {
  contenedor.innerHTML = '';
  const [areas, variedades, todas] = await Promise.all([
    opcionesAreas(contexto.fincaId),
    opcionesVariedades('banano'),
    repos.listarPorFinca('entregas_banano', contexto.fincaId),
  ]);
  const filas = todas.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const stats = calcularEstadisticas(filas, 'cantidad_manos');

  const rejilla = elemento('div', { class: 'rejilla-estadisticas' }, [
    tarjetaEstadistica(stats.dia.toLocaleString('es-CR'), 'Manos hoy'),
    tarjetaEstadistica(stats.sem.toLocaleString('es-CR'), 'Manos esta semana'),
    tarjetaEstadistica(stats.mesTotal.toLocaleString('es-CR'), 'Manos este mes'),
    tarjetaEstadistica(filas.length, 'Entregas registradas'),
  ]);
  contenedor.appendChild(rejilla);

  if (contexto.fincaId === 'todas') {
    contenedor.appendChild(
      elemento('p', { class: 'subtitulo-pantalla' }, 'Selecciona una finca específica para registrar una entrega nueva (estás viendo el consolidado de todas).')
    );
  } else {
    const form = crearFormulario({
      textoBoton: '🍌 Registrar entrega de banano',
      campos: [
        { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', requerido: true, valor: hoyISO() },
        { nombre: 'area_id', etiqueta: 'Área', tipo: 'select', requerido: true, opciones: areas },
        { nombre: 'variedad_id', etiqueta: 'Variedad', tipo: 'select', opciones: variedades },
        { nombre: 'calidad', etiqueta: 'Calidad', tipo: 'select', requerido: true, opciones: [{ value: 'primera', label: 'Primera' }, { value: 'segunda', label: 'Segunda' }] },
        { nombre: 'cantidad_cajas', etiqueta: 'Cantidad de cajas', tipo: 'number', paso: '0.01' },
        { nombre: 'cantidad_manos', etiqueta: 'Cantidad de manos', tipo: 'number', requerido: true },
        { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea' },
      ],
      alGuardar: async (valores) => {
        const sesion = await auth.sesionActual();
        await repos.crear('entregas_banano', {
          finca_id: contexto.fincaId,
          area_id: valores.area_id || null,
          fecha: valores.fecha,
          cantidad_cajas: valores.cantidad_cajas ? Number(valores.cantidad_cajas) : 0,
          cantidad_manos: Number(valores.cantidad_manos) || 0,
          calidad: valores.calidad,
          variedad_id: valores.variedad_id || null,
          responsable_id: sesion?.usuario?.id ?? null,
          observaciones: valores.observaciones || null,
        });
        await renderizarBanano(contenedor, contexto);
      },
    });

    const filaBotonVariedad = elemento('button', { type: 'button', class: 'boton boton--fantasma', texto: '+ Nueva variedad de banano' });
    filaBotonVariedad.addEventListener('click', async () => {
      const nueva = await agregarVariedad('banano');
      if (nueva) await renderizarBanano(contenedor, contexto);
    });

    contenedor.appendChild(form);
    contenedor.appendChild(filaBotonVariedad);
    contenedor.appendChild(elemento('div', { class: 'espaciador' }));
  }

  contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Entregas recientes' }));
  contenedor.appendChild(
    listaRegistros(filas.slice(0, 15), (f) => ({
      titulo: `${formatearFecha(f.fecha)} · ${(f.cantidad_manos || 0).toLocaleString('es-CR')} manos`,
      subtitulo: `${ETIQUETA_CALIDAD[f.calidad] ?? f.calidad ?? ''}${f.cantidad_cajas ? ` · ${f.cantidad_cajas} cajas` : ''}`,
    }))
  );
}

export const produccionModulo = {
  etiqueta: 'Producción',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const pestanas = elemento('div', { class: 'pestanas' });
    const zona = elemento('div');
    contenedor.appendChild(pestanas);
    contenedor.appendChild(zona);

    const tabs = [
      { clave: 'platano', etiqueta: '🍌 Plátano', render: renderizarPlatano },
      { clave: 'banano', etiqueta: '🍌 Banano', render: renderizarBanano },
    ];

    async function activar(clave) {
      for (const boton of pestanas.children) {
        boton.classList.toggle('pestana--activa', boton.dataset.clave === clave);
      }
      const tab = tabs.find((t) => t.clave === clave);
      await tab.render(zona, contexto);
    }

    for (const tab of tabs) {
      const boton = elemento('button', { type: 'button', class: 'pestana', 'data-clave': tab.clave, texto: tab.etiqueta });
      boton.addEventListener('click', () => activar(tab.clave));
      pestanas.appendChild(boton);
    }

    await activar('platano');
  },

  /** Usado por el dashboard (Fase 9) para las tarjetas de producción del día/mes. */
  async estadisticasGlobales(fincaId) {
    const [platano, banano] = await Promise.all([
      repos.listarPorFinca('entregas_platano', fincaId),
      repos.listarPorFinca('entregas_banano', fincaId),
    ]);
    const statsPlatano = calcularEstadisticas(platano, 'cantidad_dedos');
    const statsBanano = calcularEstadisticas(banano, 'cantidad_manos');
    return {
      platanoHoy: statsPlatano.dia,
      platanoMes: statsPlatano.mesTotal,
      bananoHoy: statsBanano.dia,
      bananoMes: statsBanano.mesTotal,
    };
  },
};
