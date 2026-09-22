import { repos } from '../db/repos.js';
import { inventarioModulo } from './inventario.js';
import { incidenciasAbiertas } from './incidencias.js';
import { laboresConEstado } from './labores.js';
import { planillaModulo } from './planilla.js';
import { ventasModulo } from './ventas.js';
import { estadisticasDia, resumenEmbolsePorSemana } from './embolseCorta.js';
import { estadisticasHoy as estadisticasCargaHoy, ultimoDestinatario, resumenEntregaPorSemana } from './entregaCarga.js';
import { auth } from './auth.js';
import { elemento, tarjetaStat, icono, formatearFecha, listaRegistros, mostrarPanel } from '../ui.js';

function formatearMoneda(valor) {
  return `₡${Number(valor || 0).toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Fila de "Detalle por finca" con ícono, para que cada métrica se distinga de un vistazo. */
function filaMetrica(nombreIcono, etiqueta, valor, alerta = false) {
  return elemento('div', { class: `tarjeta-finca-resumen__metrica${alerta ? ' tarjeta-finca-resumen__metrica--alerta' : ''}` }, [
    elemento('div', { class: 'tarjeta-finca-resumen__metrica-icono', html: icono(nombreIcono, 16) }),
    elemento('span', { class: 'tarjeta-finca-resumen__metrica-etiqueta', texto: etiqueta }),
    elemento('strong', { class: 'tarjeta-finca-resumen__metrica-valor', texto: String(valor) }),
  ]);
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

/** Nombre a mostrar en el título del panel: "todas las fincas" o el nombre de la finca actual. */
async function etiquetaFincaParaPanel(fincaId) {
  if (!fincaId || fincaId === 'todas') return 'todas las fincas';
  const fincas = await repos.listarTodos('fincas');
  return fincas.find((f) => f.id === fincaId)?.nombre ?? 'esta finca';
}

/**
 * Desglose de embolse por semana y variedad — para que el administrador lo
 * vea tocando la tarjeta "Embolse hoy" en Inicio, sin tener que entrar a
 * cada finca por separado. Respeta el contexto actual: si se está viendo
 * "Todas las fincas" suma todas, si se está viendo una finca específica
 * muestra solo la de ella.
 */
async function abrirResumenEmbolse(fincaId) {
  const [filas, etiquetaFinca] = await Promise.all([resumenEmbolsePorSemana(fincaId), etiquetaFincaParaPanel(fincaId)]);
  const lista = listaRegistros(filas, (f) => {
    const desde = new Date(f.semana + 'T00:00:00');
    const hasta = new Date(desde);
    hasta.setDate(hasta.getDate() + 6);
    return {
      titulo: `Semana del ${formatearFecha(f.semana)} al ${formatearFecha(hasta.toISOString().slice(0, 10))}`,
      subtitulo: `Plátano: ${f['Plátano'].toLocaleString('es-CR')} · Banano: ${f['Banano'].toLocaleString('es-CR')}${f.FHIA ? ' · FHIA: ' + f.FHIA.toLocaleString('es-CR') : ''}`,
    };
  }, { vacioTexto: 'Sin embolse registrado todavía.' });
  mostrarPanel({ titulo: `🎗️ Embolse por semana (${etiquetaFinca})`, contenido: lista });
}

/**
 * Desglose de Entrega de Carga por semana (cajas de primera/segunda, y a
 * quién se le entregó cada una) — igual que el de embolse, tocando la
 * tarjeta "Entrega de carga" en Inicio, respetando el contexto actual.
 */
async function abrirResumenEntregaCarga(fincaId) {
  const [semanas, etiquetaFinca] = await Promise.all([resumenEntregaPorSemana(fincaId), etiquetaFincaParaPanel(fincaId)]);
  const contenido = elemento('div', { class: 'lista-registros' });
  if (semanas.length === 0) {
    contenido.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Sin entregas de carga registradas todavía.' }));
  }
  for (const f of semanas) {
    const desde = new Date(f.semana + 'T00:00:00');
    const hasta = new Date(desde);
    hasta.setDate(hasta.getDate() + 6);
    contenido.appendChild(
      elemento('div', { class: 'fila-registro', style: 'align-items:flex-start' }, [
        elemento('div', { style: 'flex:1' }, [
          elemento('div', { class: 'fila-registro__titulo', texto: `Semana del ${formatearFecha(f.semana)} al ${formatearFecha(hasta.toISOString().slice(0, 10))}` }),
          elemento('div', { class: 'fila-registro__subtitulo', texto: `Primera: ${f.primera.toLocaleString('es-CR')} · Segunda: ${f.segunda.toLocaleString('es-CR')}` }),
          f.porDestinatario.length > 0
            ? elemento(
                'div',
                { style: 'margin-top:6px;display:flex;flex-direction:column;gap:2px' },
                f.porDestinatario.map((d) =>
                  elemento('div', { class: 'tarjeta-finca-resumen__metrica' }, [
                    elemento('span', {}, `Entregado a ${d.nombre}`),
                    elemento('strong', {}, `${d.primera}/${d.segunda}`),
                  ])
                )
              )
            : null,
        ]),
      ])
    );
  }
  mostrarPanel({ titulo: `🧺 Entrega de carga por semana (${etiquetaFinca})`, contenido });
}

/** Usado por el dashboard y por la pantalla de detalle de finca. */
export async function estadisticasDeFinca(fincaId) {
  const [insumosBajos, abiertas, labores, personal, totalPersonal, ventasMes, dia, cargaHoy, ultimaEntrega] = await Promise.all([
    inventarioModulo.insumosBajos(fincaId),
    incidenciasAbiertas(fincaId),
    laboresConEstado(fincaId),
    planillaModulo.presentesAusentesHoy(fincaId),
    planillaModulo.totalActivos(fincaId),
    ventasModulo.totalVendidoMes(fincaId),
    estadisticasDia(fincaId),
    estadisticasCargaHoy(fincaId),
    ultimoDestinatario(fincaId),
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
    ultimaEntrega,
  };
}

export async function renderizarDashboard(contenedor, contexto, manejadores = {}) {
  contenedor.innerHTML = '';
  const [stats, sesion] = await Promise.all([estadisticasDeFinca(contexto.fincaId), auth.sesionActual()]);
  const esAdmin = sesion?.usuario?.rol === 'administrador';
  const { alTocarIncidencias } = manejadores;

  // ---- Resumen general: a propósito solo estos 4, se pidió limpiar el
  // dashboard de las demás tarjetas (Producción/Personal/Ventas/Inventario/
  // Otros indicadores) — "Detalle por finca" más abajo sigue teniendo el
  // resto para quien lo necesite viendo "Todas las fincas". ----
  // "Embolse hoy" y "Entrega de carga" son tocables solo para
  // administrador: abren el desglose por semana de TODAS las fincas, para
  // no tener que entrar a cada una a revisarlo.
  contenedor.appendChild(
    elemento('div', { class: 'seccion-dashboard' }, [
      elemento('h2', { class: 'seccion-dashboard__titulo', texto: 'Resumen general' }),
      elemento('div', { class: 'rejilla-estadisticas' }, [
        tarjetaStat('package', stats.embolsadoHoy.toLocaleString('es-CR'), 'Embolse hoy', '', esAdmin ? () => abrirResumenEmbolse(contexto.fincaId) : null),
        tarjetaStat('crop', stats.cortadoHoy.toLocaleString('es-CR'), 'Corta hoy'),
        tarjetaStat('basket', stats.cargaHoy.total.toLocaleString('es-CR'), 'Entrega de carga', '', esAdmin ? () => abrirResumenEntregaCarga(contexto.fincaId) : null),
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
      const necesitaAtencion = s.insumosBajos.length > 0 || s.abiertas.length > 0;
      comparativa.appendChild(
        elemento('div', { class: 'tarjeta tarjeta-finca-resumen' }, [
          elemento('div', { class: 'tarjeta-finca-resumen__cabecera' }, [
            elemento('span', { texto: finca.nombre }),
            elemento('span', {
              class: `tarjeta-finca-resumen__estado${necesitaAtencion ? ' tarjeta-finca-resumen__estado--alerta' : ''}`,
              texto: necesitaAtencion ? 'Atención' : 'Al día',
            }),
          ]),
          elemento('div', { class: 'tarjeta-finca-resumen__metricas' }, [
            filaMetrica('crop', 'Racimos hoy', s.cortadoHoy.toLocaleString('es-CR')),
            filaMetrica('basket', 'Cajas hoy (1ª/2ª)', `${s.cargaHoy.primera}/${s.cargaHoy.segunda}`),
            filaMetrica('users', 'Personal', `${s.personal.presentes}/${s.personal.total}`),
            filaMetrica('user', 'Último destinatario', s.ultimaEntrega?.nombre ?? '—'),
            filaMetrica('alert', 'Incidencias', String(s.abiertas.length), s.abiertas.length > 0),
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
