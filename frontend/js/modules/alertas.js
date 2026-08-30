/**
 * Centro de alertas — se calcula en el dispositivo a partir de los datos ya
 * sincronizados (inventario, labores, incidencias), así que funciona igual
 * con o sin internet: no depende de que el servidor "empuje" una
 * notificación en el momento exacto (no hay infraestructura de push en
 * esta entrega — ver la nota en el documento de arquitectura). Cada vez que
 * se abre el módulo o el dashboard, las alertas se recalculan al instante.
 */
import { inventarioModulo } from './inventario.js';
import { laboresConEstado } from './labores.js';
import { incidenciasUrgentesPendientes, incidenciasAbiertas } from './incidencias.js';
import { repos } from '../db/repos.js';
import { elemento, formatearFecha } from '../ui.js';

const NOMBRE_LABOR = { deshija: 'Deshija', dermaticida: 'Dermaticida', fertilizacion: 'Fertilización' };

export async function calcularAlertas(fincaId) {
  const [insumosBajos, labores, urgentes] = await Promise.all([
    inventarioModulo.insumosBajos(fincaId),
    laboresConEstado(fincaId),
    incidenciasUrgentesPendientes(fincaId),
  ]);

  const fincas = await repos.listarTodos('fincas');
  const areas = await repos.listarTodos('areas');
  const nombreFinca = Object.fromEntries(fincas.map((f) => [f.id, f.nombre]));
  const nombreArea = Object.fromEntries(areas.map((a) => [a.id, a.nombre]));

  const alertas = [];

  for (const insumo of insumosBajos) {
    alertas.push({
      tipo: 'inventario_bajo',
      icono: '⚠️',
      titulo: 'Inventario bajo',
      mensaje: `${nombreFinca[insumo.finca_id] ?? 'Finca'} tiene menos ${insumo.nombre.toLowerCase()} de lo requerido (mínimo ${insumo.cantidad_minima} ${insumo.unidad}).`,
      severidad: 'alta',
    });
  }

  for (const labor of labores) {
    if (labor.estado?.clase === 'insignia--rojo') {
      alertas.push({
        tipo: 'labor_atrasada',
        icono: '⚠️',
        titulo: 'Labor atrasada',
        mensaje: `${NOMBRE_LABOR[labor.tabla.replace('labores_', '')] ?? 'Labor'} del área ${nombreArea[labor.area_id] ?? ''} está atrasada (era el ${formatearFecha(labor.proxima_fecha)}).`,
        severidad: 'alta',
      });
    } else if (labor.estado?.clase === 'insignia--ambar') {
      alertas.push({
        tipo: 'labor_proxima',
        icono: '🔔',
        titulo: 'Labor próxima',
        mensaje: `${NOMBRE_LABOR[labor.tabla.replace('labores_', '')] ?? 'Labor'} del área ${nombreArea[labor.area_id] ?? ''} está programada para el ${formatearFecha(labor.proxima_fecha)}.`,
        severidad: 'media',
      });
    }
  }

  for (const inc of urgentes) {
    alertas.push({
      tipo: 'incidencia_urgente',
      icono: '🔴',
      titulo: 'Incidencia urgente',
      mensaje: `Se reportó una incidencia urgente en ${nombreFinca[inc.finca_id] ?? 'una finca'}: ${inc.descripcion}`,
      severidad: 'urgente',
    });
  }

  const orden = { urgente: 0, alta: 1, media: 2 };
  alertas.sort((a, b) => (orden[a.severidad] ?? 9) - (orden[b.severidad] ?? 9));
  return alertas;
}

export const alertasModulo = {
  etiqueta: 'Alertas',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const alertas = await calcularAlertas(contexto.fincaId);

    if (alertas.length === 0) {
      contenedor.appendChild(elemento('div', { class: 'tarjeta centro-texto' }, [
        elemento('p', { texto: '✅ Sin alertas pendientes en este momento.' }),
      ]));
      return;
    }

    const abiertasIncidencias = await incidenciasAbiertas(contexto.fincaId);
    contenedor.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: `${alertas.length} alerta(s) activa(s) · ${abiertasIncidencias.length} incidencia(s) abierta(s) en total` }));

    const lista = elemento('div', { class: 'lista-registros' });
    for (const alerta of alertas) {
      lista.appendChild(
        elemento('div', { class: 'fila-registro', style: 'align-items:flex-start' }, [
          elemento('div', {}, [
            elemento('div', { class: 'fila-registro__titulo', texto: `${alerta.icono} ${alerta.titulo}` }),
            elemento('div', { class: 'fila-registro__subtitulo', texto: alerta.mensaje }),
          ]),
        ])
      );
    }
    contenedor.appendChild(lista);
  },
};
