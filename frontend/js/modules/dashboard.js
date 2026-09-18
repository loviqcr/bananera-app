import { repos } from '../db/repos.js';
import { inventarioModulo } from './inventario.js';
import { incidenciasAbiertas } from './incidencias.js';
import { laboresConEstado } from './labores.js';
import { planillaModulo } from './planilla.js';
import { ventasModulo } from './ventas.js';
import { estadisticasDia } from './embolseCorta.js';
import { estadisticasHoy as estadisticasCargaHoy } from './entregaCarga.js';
import { elemento, tarjetaStat } from '../ui.js';

function formatearMoneda(valor) {
  return `₡${Number(valor || 0).toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Cuántas cajas (1ª/2ª) le tocaron a cada destinatario hoy, con un límite para no hacer crecer la tarjeta sin control. */
function filaEntregadoA(porDestinatario, limite = 3) {
  const visibles = porDestinatario.slice(0, limite);
  const filas = [
    elemento('div', { style: 'font-weight:700;color:var(--texto-suave);font-size:0.82rem' }, 'Entregado a'),
    ...visibles.map((d) =>
      elemento('div', { class: 'tarjeta-finca-resumen__metrica' }, [elemento('span', {}, d.nombre), elemento('strong', {}, `${d.primera}/${d.segunda}`)])
    ),
  ];
  if (porDestinatario.length > limite) {
    filas.push(elemento('div', { class: 'tarjeta-finca-resumen__metrica' }, [elemento('span', {}, `y ${porDestinatario.length - limite} más`)]));
  }
  return elemento('div', { style: 'margin-top:8px;padding-top:8px;border-top:1px solid var(--borde);display:flex;flex-direction:column;gap:4px' }, filas);
}

/** Usado por el dashboard y por la pantalla de detalle de finca. */
export async function estadisticasDeFinca(fincaId) {
  const [insumosBajos, abiertas, labores, personal, totalPersonal, ventasMes, dia, cargaHoy] = await Promise.all([
    inventarioModulo.insumosBajos(fincaId),
    incidenciasAbiertas(fincaId),
    laboresConEstado(fincaId),
    planillaModulo.presentesAusentesHoy(fincaId),
    planillaModulo.totalActivos(fincaId),
    ventasModulo.totalVendidoMes(fincaId),
    estadisticasDia(fincaId),
    estadisticasCargaHoy(fincaId),
  ]);
  // Solo se usa en la pantalla de detalle de finca (Fincas > tocar una).
  const atrasadas = labores.filter((l) => l.estado?.clase === 'insignia--rojo').length;
  return {
    insumosBajos,
    abiertas,
    atrasadas,
    personal: { ...personal, total: totalPersonal },
    ventasMes,
    embolsadoHoy: dia.embolsadoHoy,
    cortadoHoy: dia.cortadoHoy,
    proximosACorta: dia.proximosACorta,
    cargaHoy,
  };
}

export async function renderizarDashboard(contenedor, contexto, manejadores = {}) {
  contenedor.innerHTML = '';
  const stats = await estadisticasDeFinca(contexto.fincaId);
  const { alTocarIncidencias } = manejadores;

  // ---- Resumen general: a propósito solo estos 3, se pidió limpiar el
  // dashboard de las demás tarjetas (Producción/Personal/Cajas/Ventas/
  // Inventario/Otros indicadores) — "Detalle por finca" más abajo sigue
  // teniendo el resto para quien lo necesite viendo "Todas las fincas". ----
  contenedor.appendChild(
    elemento('div', { class: 'seccion-dashboard' }, [
      elemento('h2', { class: 'seccion-dashboard__titulo', texto: 'Resumen general' }),
      elemento('div', { class: 'rejilla-estadisticas' }, [
        tarjetaStat('package', stats.embolsadoHoy.toLocaleString('es-CR'), 'Embolse hoy'),
        tarjetaStat('crop', stats.cortadoHoy.toLocaleString('es-CR'), 'Corta hoy'),
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
          s.cargaHoy.porDestinatario.length > 0 ? filaEntregadoA(s.cargaHoy.porDestinatario) : null,
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

}
