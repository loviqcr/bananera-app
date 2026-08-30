import { repos } from '../db/repos.js';
import { produccionModulo } from './produccion.js';
import { inventarioModulo } from './inventario.js';
import { incidenciasAbiertas } from './incidencias.js';
import { laboresConEstado } from './labores.js';
import { planillaModulo } from './planilla.js';
import { ventasModulo } from './ventas.js';
import { elemento, tarjetaEstadistica } from '../ui.js';

function formatearMoneda(valor) {
  return `₡${Number(valor || 0).toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

async function estadisticasDeFinca(fincaId) {
  const [produccion, insumosBajos, abiertas, labores, personal, ventasMes] = await Promise.all([
    produccionModulo.estadisticasGlobales(fincaId),
    inventarioModulo.insumosBajos(fincaId),
    incidenciasAbiertas(fincaId),
    laboresConEstado(fincaId),
    planillaModulo.presentesAusentesHoy(fincaId),
    ventasModulo.totalVendidoMes(fincaId),
  ]);
  const atrasadas = labores.filter((l) => l.estado?.clase === 'insignia--rojo').length;
  const proximas = labores.filter((l) => l.estado?.clase === 'insignia--ambar').length;
  return { produccion, insumosBajos, abiertas, atrasadas, proximas, personal, ventasMes };
}

export async function renderizarDashboard(contenedor, contexto) {
  contenedor.innerHTML = '';
  const stats = await estadisticasDeFinca(contexto.fincaId);

  const rejilla = elemento('div', { class: 'rejilla-estadisticas' }, [
    tarjetaEstadistica(stats.produccion.platanoHoy.toLocaleString('es-CR'), 'Dedos de plátano hoy'),
    tarjetaEstadistica(stats.produccion.bananoHoy.toLocaleString('es-CR'), 'Manos de banano hoy'),
    tarjetaEstadistica(formatearMoneda(stats.ventasMes), 'Ventas del mes'),
    tarjetaEstadistica(stats.personal.presentes, 'Personal presente hoy'),
    tarjetaEstadistica(stats.personal.ausentes, 'Personal ausente hoy', stats.personal.ausentes > 0 ? 'estadistica--pendiente' : ''),
    tarjetaEstadistica(stats.insumosBajos.length, 'Insumos con inventario bajo', stats.insumosBajos.length > 0 ? 'estadistica--alerta' : ''),
    tarjetaEstadistica(stats.abiertas.length, 'Incidencias pendientes', stats.abiertas.length > 0 ? 'estadistica--alerta' : ''),
    tarjetaEstadistica(stats.atrasadas, 'Labores atrasadas', stats.atrasadas > 0 ? 'estadistica--alerta' : ''),
    tarjetaEstadistica(stats.proximas, 'Labores próximas', stats.proximas > 0 ? 'estadistica--pendiente' : ''),
  ]);
  contenedor.appendChild(rejilla);

  if (contexto.fincaId === 'todas') {
    const fincas = await repos.listarTodos('fincas');
    const comparativa = elemento('div', { class: 'comparativa-fincas' });
    comparativa.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Rendimiento por finca' }));
    for (const finca of fincas.sort((a, b) => a.orden - b.orden)) {
      const s = await estadisticasDeFinca(finca.id);
      comparativa.appendChild(
        elemento('div', { class: 'tarjeta tarjeta-finca-resumen' }, [
          elemento('div', { class: 'tarjeta-finca-resumen__cabecera' }, [
            elemento('span', { texto: finca.nombre }),
            elemento('span', { texto: s.insumosBajos.length > 0 ? '⚠️' : '✅' }),
          ]),
          elemento('div', { class: 'tarjeta-finca-resumen__metricas' }, [
            elemento('div', { class: 'tarjeta-finca-resumen__metrica' }, [elemento('span', {}, 'Plátano hoy'), elemento('strong', {}, s.produccion.platanoHoy.toLocaleString('es-CR'))]),
            elemento('div', { class: 'tarjeta-finca-resumen__metrica' }, [elemento('span', {}, 'Banano hoy'), elemento('strong', {}, s.produccion.bananoHoy.toLocaleString('es-CR'))]),
            elemento('div', { class: 'tarjeta-finca-resumen__metrica' }, [elemento('span', {}, 'Ventas mes'), elemento('strong', {}, formatearMoneda(s.ventasMes))]),
            elemento('div', { class: 'tarjeta-finca-resumen__metrica' }, [elemento('span', {}, 'Incidencias'), elemento('strong', {}, String(s.abiertas.length))]),
          ]),
        ])
      );
    }
    contenedor.appendChild(comparativa);
  }
}
