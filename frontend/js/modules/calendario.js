import { repos } from '../db/repos.js';
import { elemento, formatearFecha, hoyISO } from '../ui.js';

const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

const ICONO_TIPO = {
  siembra: '🌱',
  deshija: '✂️',
  dermaticida: '🧪',
  fertilizacion: '🧪',
  embolse: '🎗️',
  corta: '✂️',
};

async function recolectarEventos(fincaId) {
  const [siembra, deshija, dermaticida, fertilizacion, embolse, corta] = await Promise.all([
    repos.listarPorFinca('labores_siembra', fincaId),
    repos.listarPorFinca('labores_deshija', fincaId),
    repos.listarPorFinca('labores_dermaticida', fincaId),
    repos.listarPorFinca('labores_fertilizacion', fincaId),
    repos.listarPorFinca('embolse', fincaId),
    repos.listarPorFinca('corta', fincaId),
  ]);

  const eventos = []; // { fecha, tipo, estado: 'completada'|'proxima'|'atrasada', detalle }
  const hoy = hoyISO();

  const agregarCompletado = (filas, tipo, detalle) => {
    for (const f of filas) eventos.push({ fecha: f.fecha, tipo, estado: 'completada', detalle: detalle(f) });
  };
  agregarCompletado(siembra, 'siembra', (f) => f.nombre || 'Siembra');
  agregarCompletado(embolse, 'embolse', (f) => `Embolse (${f.cantidad ?? '—'})`);
  agregarCompletado(corta, 'corta', (f) => `Corta: ${f.racimos_cortados ?? '—'} racimos`);

  const agregarConFrecuencia = (filas, tipo, etiqueta) => {
    for (const f of filas) {
      eventos.push({ fecha: f.fecha, tipo, estado: 'completada', detalle: `${etiqueta} realizada` });
      if (f.proxima_fecha) {
        eventos.push({
          fecha: f.proxima_fecha,
          tipo,
          estado: f.proxima_fecha < hoy ? 'atrasada' : 'proxima',
          detalle: `${etiqueta} programada`,
        });
      }
    }
  };
  agregarConFrecuencia(deshija, 'deshija', 'Deshija');
  agregarConFrecuencia(dermaticida, 'dermaticida', 'Dermaticida');
  agregarConFrecuencia(fertilizacion, 'fertilizacion', 'Fertilización');

  return eventos;
}

export const calendarioModulo = {
  etiqueta: 'Calendario',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const eventos = await recolectarEventos(contexto.fincaId);
    let cursor = new Date();
    cursor.setDate(1);
    let diaSeleccionado = hoyISO();

    const cabecera = elemento('div', { class: 'calendario-cabecera' });
    const rejilla = elemento('div', { class: 'rejilla-calendario' });
    const panelDia = elemento('div');
    contenedor.appendChild(cabecera);
    contenedor.appendChild(rejilla);
    contenedor.appendChild(panelDia);

    function eventosDelDia(fechaISO) {
      return eventos.filter((e) => e.fecha === fechaISO);
    }

    function pintarPanelDia() {
      panelDia.innerHTML = '';
      const del = eventosDelDia(diaSeleccionado);
      panelDia.appendChild(
        elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.05rem', texto: formatearFecha(diaSeleccionado) })
      );
      if (del.length === 0) {
        panelDia.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Sin labores programadas ni realizadas este día.' }));
        return;
      }
      const lista = elemento('div', { class: 'lista-registros' });
      for (const ev of del) {
        const insignia =
          ev.estado === 'atrasada' ? '🔴 Atrasada' : ev.estado === 'proxima' ? '🟡 Próxima' : '🟢 Completada';
        lista.appendChild(
          elemento('div', { class: 'fila-registro' }, [
            elemento('div', {}, [
              elemento('div', { class: 'fila-registro__titulo', texto: `${ICONO_TIPO[ev.tipo] ?? '📌'} ${ev.detalle}` }),
            ]),
            elemento('div', { class: 'fila-registro__valor', texto: insignia }),
          ])
        );
      }
      panelDia.appendChild(lista);
    }

    function pintarMes() {
      cabecera.innerHTML = '';
      rejilla.innerHTML = '';

      cabecera.appendChild(elemento('button', { class: 'boton-icono', style: 'background:var(--verde-100);color:var(--primario-fuerte)', onclick: () => cambiarMes(-1), texto: '‹' }));
      cabecera.appendChild(elemento('span', { class: 'calendario-cabecera__mes', texto: `${NOMBRES_MES[cursor.getMonth()]} ${cursor.getFullYear()}` }));
      cabecera.appendChild(elemento('button', { class: 'boton-icono', style: 'background:var(--verde-100);color:var(--primario-fuerte)', onclick: () => cambiarMes(1), texto: '›' }));

      for (const d of DIAS_SEMANA) rejilla.appendChild(elemento('div', { class: 'calendario-diasemana', texto: d }));

      const primerDiaSemana = (cursor.getDay() + 6) % 7; // 0 = lunes
      const diasEnMes = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();

      for (let i = 0; i < primerDiaSemana; i++) rejilla.appendChild(elemento('div', { class: 'calendario-dia calendario-dia--vacio' }));

      for (let dia = 1; dia <= diasEnMes; dia++) {
        const fechaISO = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        const del = eventosDelDia(fechaISO);
        const clases = ['calendario-dia'];
        if (fechaISO === hoyISO()) clases.push('calendario-dia--hoy');
        if (fechaISO === diaSeleccionado) clases.push('calendario-dia--seleccionado');

        const puntos = elemento('div', { class: 'calendario-dia__puntos' });
        const estadosUnicos = new Set(del.map((e) => e.estado));
        if (estadosUnicos.has('atrasada')) puntos.appendChild(elemento('span', { class: 'punto punto--rojo' }));
        if (estadosUnicos.has('proxima')) puntos.appendChild(elemento('span', { class: 'punto punto--ambar' }));
        if (estadosUnicos.has('completada')) puntos.appendChild(elemento('span', { class: 'punto punto--verde' }));

        const celda = elemento('div', { class: clases.join(' '), onclick: () => { diaSeleccionado = fechaISO; pintarMes(); pintarPanelDia(); } }, [
          elemento('span', { texto: String(dia) }),
          puntos,
        ]);
        rejilla.appendChild(celda);
      }
    }

    function cambiarMes(delta) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
      pintarMes();
    }

    pintarMes();
    pintarPanelDia();
  },
};
