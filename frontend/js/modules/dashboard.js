import { repos } from '../db/repos.js';
import { produccionModulo } from './produccion.js';
import { inventarioModulo } from './inventario.js';
import { incidenciasAbiertas } from './incidencias.js';
import { laboresConEstado } from './labores.js';
import { planillaModulo } from './planilla.js';
import { ventasModulo } from './ventas.js';
import { estadisticasDia } from './embolseCorta.js';
import { estadisticasHoy as estadisticasCargaHoy } from './entregaCarga.js';
import { elemento, tarjetaEstadistica, tarjetaStat } from '../ui.js';

function formatearMoneda(valor) {
  return `₡${Number(valor || 0).toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Usado por el dashboard y por la pantalla de detalle de finca. */
export async function estadisticasDeFinca(fincaId) {
  const [produccion, insumosBajos, abiertas, labores, personal, totalPersonal, ventasMes, dia, cargaHoy] = await Promise.all([
    produccionModulo.estadisticasGlobales(fincaId),
    inventarioModulo.insumosBajos(fincaId),
    incidenciasAbiertas(fincaId),
    laboresConEstado(fincaId),
    planillaModulo.presentesAusentesHoy(fincaId),
    planillaModulo.totalActivos(fincaId),
    ventasModulo.totalVendidoMes(fincaId),
    estadisticasDia(fincaId),
    estadisticasCargaHoy(fincaId),
  ]);
  const atrasadas = labores.filter((l) => l.estado?.clase === 'insignia--rojo').length;
  const proximas = labores.filter((l) => l.estado?.clase === 'insignia--ambar').length;
  return {
    produccion,
    insumosBajos,
    abiertas,
    atrasadas,
    proximas,
    personal: { ...personal, total: totalPersonal },
    ventasMes,
    embolsadoHoy: dia.embolsadoHoy,
    cortadoHoy: dia.cortadoHoy,
    proximosACorta: dia.proximosACorta,
    cargaHoy,
  };
}

const LABORES_ACCESO_RAPIDO = [
  { clave: 'siembra', etiqueta: '🌱 Siembra' },
  { clave: 'deshija', etiqueta: '✂️ Deshija' },
  { clave: 'dermaticida', etiqueta: '🧪 Nematicida' },
  { clave: 'fertilizacion', etiqueta: '🧪 Fertilización' },
];

export async function renderizarDashboard(contenedor, contexto, manejadores = {}) {
  contenedor.innerHTML = '';
  const stats = await estadisticasDeFinca(contexto.fincaId);
  const { alTocarIncidencias, alTocarPersonal, alTocarLabor } = manejadores;

  // ---- Tarjetas principales (equivalente a la portada del boceto) ----
  contenedor.appendChild(
    elemento('div', { class: 'rejilla-estadisticas' }, [
      tarjetaStat('basket', stats.cortadoHoy.toLocaleString('es-CR'), 'Producción hoy · racimos'),
      tarjetaStat('users', `${stats.personal.presentes} / ${stats.personal.total}`, 'Personal presente', '', alTocarPersonal),
      tarjetaStat('basket', `${stats.cargaHoy.primera} / ${stats.cargaHoy.segunda}`, 'Cajas hoy · primera / segunda'),
      tarjetaStat('alert', stats.abiertas.length, 'Alertas — requieren atención', stats.abiertas.length > 0 ? 'tarjeta-stat--alerta' : '', alTocarIncidencias),
    ])
  );

  // ---- Acceso rápido a Labores (para no tener que entrar a Labores y
  // buscar la pestaña correcta cada vez) ----
  if (alTocarLabor) {
    contenedor.appendChild(
      elemento('div', { class: 'seccion-dashboard' }, [
        elemento('h2', { class: 'seccion-dashboard__titulo', texto: 'Registrar labor' }),
        elemento(
          'div',
          { class: 'pestanas', style: 'flex-wrap:wrap' },
          LABORES_ACCESO_RAPIDO.map((labor) =>
            elemento('button', {
              type: 'button',
              class: 'pestana',
              texto: labor.etiqueta,
              onclick: () => alTocarLabor(labor.clave),
            })
          )
        ),
      ])
    );
  }

  // ---- Resumen general ----
  contenedor.appendChild(
    elemento('div', { class: 'seccion-dashboard' }, [
      elemento('h2', { class: 'seccion-dashboard__titulo', texto: 'Resumen general' }),
      elemento('div', { class: 'rejilla-estadisticas' }, [
        tarjetaStat('package', stats.embolsadoHoy.toLocaleString('es-CR'), 'Embolse hoy'),
        tarjetaStat('crop', stats.cortadoHoy.toLocaleString('es-CR'), 'Corta hoy'),
        tarjetaStat('package', stats.insumosBajos.length, 'Inventario bajo', stats.insumosBajos.length > 0 ? 'tarjeta-stat--ambar' : ''),
        tarjetaStat('alert', stats.abiertas.length, 'Incidencias pendientes', stats.abiertas.length > 0 ? 'tarjeta-stat--alerta' : '', alTocarIncidencias),
      ]),
    ])
  );

  // ---- Producción por finca (solo viendo "todas las fincas") ----
  if (contexto.fincaId === 'todas') {
    let fincas = (await repos.listarTodos('fincas')).sort((a, b) => a.orden - b.orden);
    if (contexto.fincaIdsPermitidas) {
      fincas = fincas.filter((f) => contexto.fincaIdsPermitidas.includes(f.id));
    }
    const rejillaMini = elemento('div', { class: 'rejilla-fincas-mini' });
    const comparativa = elemento('div', { class: 'comparativa-fincas' });

    for (const finca of fincas) {
      const s = await estadisticasDeFinca(finca.id);
      rejillaMini.appendChild(
        elemento('div', { class: 'tarjeta-finca-mini' }, [
          elemento('div', { class: 'tarjeta-finca-mini__nombre', texto: finca.nombre }),
          elemento('div', { class: 'tarjeta-finca-mini__valor', texto: s.cortadoHoy.toLocaleString('es-CR') }),
        ])
      );
      comparativa.appendChild(
        elemento('div', { class: 'tarjeta tarjeta-finca-resumen' }, [
          elemento('div', { class: 'tarjeta-finca-resumen__cabecera' }, [
            elemento('span', { texto: finca.nombre }),
            elemento('span', { texto: s.insumosBajos.length > 0 || s.abiertas.length > 0 ? '⚠️' : '✅' }),
          ]),
          elemento('div', { class: 'tarjeta-finca-resumen__metricas' }, [
            elemento('div', { class: 'tarjeta-finca-resumen__metrica' }, [elemento('span', {}, 'Racimos hoy'), elemento('strong', {}, s.cortadoHoy.toLocaleString('es-CR'))]),
            elemento('div', { class: 'tarjeta-finca-resumen__metrica' }, [elemento('span', {}, 'Cajas hoy (1ª/2ª)'), elemento('strong', {}, `${s.cargaHoy.primera}/${s.cargaHoy.segunda}`)]),
            elemento('div', { class: 'tarjeta-finca-resumen__metrica' }, [elemento('span', {}, 'Personal'), elemento('strong', {}, `${s.personal.presentes}/${s.personal.total}`)]),
            elemento('div', { class: 'tarjeta-finca-resumen__metrica' }, [elemento('span', {}, 'Ventas mes'), elemento('strong', {}, formatearMoneda(s.ventasMes))]),
            elemento('div', { class: 'tarjeta-finca-resumen__metrica' }, [elemento('span', {}, 'Incidencias'), elemento('strong', {}, String(s.abiertas.length))]),
          ]),
        ])
      );
    }

    contenedor.appendChild(
      elemento('div', { class: 'seccion-dashboard' }, [elemento('h2', { class: 'seccion-dashboard__titulo', texto: 'Producción por finca' }), rejillaMini])
    );
    contenedor.appendChild(
      elemento('div', { class: 'seccion-dashboard' }, [elemento('h2', { class: 'seccion-dashboard__titulo', texto: 'Detalle por finca' }), comparativa])
    );
  }

  // ---- Otros indicadores (detalle que ya existía antes del rediseño) ----
  contenedor.appendChild(
    elemento('div', { class: 'seccion-dashboard' }, [
      elemento('h2', { class: 'seccion-dashboard__titulo', texto: 'Otros indicadores' }),
      elemento('div', { class: 'rejilla-estadisticas' }, [
        tarjetaEstadistica(stats.produccion.platanoHoy.toLocaleString('es-CR'), 'Dedos de plátano hoy'),
        tarjetaEstadistica(stats.produccion.bananoHoy.toLocaleString('es-CR'), 'Manos de banano hoy'),
        tarjetaEstadistica(stats.atrasadas, 'Labores atrasadas', stats.atrasadas > 0 ? 'estadistica--alerta' : ''),
        tarjetaEstadistica(stats.proximas, 'Labores próximas', stats.proximas > 0 ? 'estadistica--pendiente' : ''),
      ]),
    ])
  );
}
