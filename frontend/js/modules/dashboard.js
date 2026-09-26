import { repos } from '../db/repos.js';
import { inventarioModulo } from './inventario.js';
import { incidenciasAbiertas } from './incidencias.js';
import { laboresConEstado } from './labores.js';
import { planillaModulo } from './planilla.js';
import { ventasModulo } from './ventas.js';
import { estadisticasDia, resumenEmbolsePorSemana } from './embolseCorta.js';
import { estadisticasHoy as estadisticasCargaHoy, ultimoDestinatario, resumenEntregaPorSemana, mensajeEntregaWhatsApp, abrirWhatsApp } from './entregaCarga.js';
import { auth } from './auth.js';
import { elemento, tarjetaStat, icono, formatearFecha, hoyISO, mostrarPanel } from '../ui.js';

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
 * Desglose de embolse por semana y variedad. Respeta el contexto actual: si
 * se está viendo "Todas las fincas" suma todas, si se está viendo una finca
 * específica muestra solo la de ella. Tocar una semana la despliega con el
 * detalle por finca (o por área, viendo una sola finca) y su cantidad.
 */
async function construirSemanasEmbolse(fincaId) {
  const semanas = await resumenEmbolsePorSemana(fincaId);
  const porFinca = !fincaId || fincaId === 'todas';
  const cantidades = (x) =>
    `Plátano: ${x['Plátano'].toLocaleString('es-CR')} · Banano: ${x['Banano'].toLocaleString('es-CR')}${x.FHIA ? ' · FHIA: ' + x.FHIA.toLocaleString('es-CR') : ''}${x['Sin variedad'] ? ' · Sin variedad: ' + x['Sin variedad'].toLocaleString('es-CR') : ''}`;

  const contenido = elemento('div', { class: 'lista-registros' });
  if (semanas.length === 0) {
    contenido.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Sin embolse registrado todavía.' }));
  }
  for (const f of semanas) {
    const desde = new Date(f.semana + 'T00:00:00');
    const hasta = new Date(desde);
    hasta.setDate(hasta.getDate() + 6);
    contenido.appendChild(
      elemento('div', { class: 'fila-registro', style: 'display:block' }, [
        elemento('details', {}, [
          elemento('summary', { style: 'cursor:pointer;list-style-position:inside' }, [
            elemento('span', { class: 'fila-registro__titulo', texto: `Semana del ${formatearFecha(f.semana)} al ${formatearFecha(hasta.toISOString().slice(0, 10))}` }),
            elemento('div', { class: 'fila-registro__subtitulo', texto: cantidades(f) }),
          ]),
          elemento(
            'div',
            { style: 'margin-top:8px;padding-top:8px;border-top:1px solid var(--borde);display:flex;flex-direction:column;gap:8px' },
            f.detalle.map((d) =>
              elemento('div', {}, [
                elemento('div', { style: 'font-weight:700', texto: d.nombre }),
                elemento('div', { class: 'fila-registro__subtitulo', texto: cantidades(d) }),
              ])
            )
          ),
        ]),
      ])
    );
  }
  if (semanas.length > 0) {
    contenido.prepend(elemento('p', { class: 'subtitulo-pantalla', texto: `Toca una semana para ver ${porFinca ? 'cada finca' : 'cada área'}.` }));
  }
  return contenido;
}

/**
 * Desglose de Entrega de Carga por semana (cajas de primera/segunda, y a
 * quién se le entregó cada una), respetando el contexto actual.
 */
async function construirSemanasEntrega(fincaId) {
  const semanas = await resumenEntregaPorSemana(fincaId);
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
  return contenido;
}

const TITULOS_HOY = {
  embolse: '🎗️ Embolse de hoy',
  corta: '✂️ Corta de hoy',
  entrega: '🧺 Entrega de carga de hoy',
};

/**
 * Lo registrado HOY, finca por finca, en una sola pantalla — para no tener
 * que entrar a cada finca a revisarlo. Viendo "Todas las fincas" salen todas
 * (las que aún no registran nada, con "Sin registros hoy", para notar de un
 * vistazo cuál falta); viendo una finca específica, solo ella.
 */
async function construirDetalleHoy(tipo, contexto) {
  const { fincaId } = contexto;
  const porFinca = !fincaId || fincaId === 'todas';
  const hoy = hoyISO();
  const tabla = { embolse: 'embolse', corta: 'corta', entrega: 'entregas_platano' }[tipo];
  const [filas, fincas, areas] = await Promise.all([repos.listarPorFinca(tabla, fincaId), repos.listarTodos('fincas'), repos.listarTodos('areas')]);
  const nombreArea = Object.fromEntries(areas.map((a) => [a.id, a.nombre]));

  let visibles = fincas.sort((a, b) => a.orden - b.orden);
  if (!porFinca) visibles = visibles.filter((f) => f.id === fincaId);
  else if (contexto.fincaIdsPermitidas) visibles = visibles.filter((f) => contexto.fincaIdsPermitidas.includes(f.id));

  const deHoy = filas.filter((f) => f.fecha === hoy && (tipo !== 'entrega' || f.grupo_entrega));
  const n = (v) => Number(v || 0).toLocaleString('es-CR');

  const bloques = visibles.map((finca) => {
    const propias = deHoy.filter((f) => f.finca_id === finca.id);
    let total = '';
    let lineas = [];
    if (tipo === 'embolse') {
      total = `${n(propias.reduce((s, f) => s + Number(f.cantidad || 0), 0))} racimos`;
      lineas = propias.map((f) => ({ texto: `${nombreArea[f.area_id] ?? 'Área'} · ${/\[Variedad: ([^\]]+)\]/.exec(f.observaciones || '')?.[1] ?? 'Sin variedad'} · ${n(f.cantidad)}` }));
    } else if (tipo === 'corta') {
      total = `${n(propias.reduce((s, f) => s + Number(f.racimos_cortados || 0), 0))} racimos`;
      lineas = propias.map((f) => ({ texto: `${nombreArea[f.area_id] ?? 'Área'} · ${n(f.racimos_cortados)} racimos` }));
    } else {
      const grupos = new Map();
      for (const f of propias) {
        const g = grupos.get(f.grupo_entrega) ?? { area: nombreArea[f.area_id] ?? 'Área', destino: f.responsable_nombre || 'Sin destinatario', observaciones: f.observaciones || '', primera: 0, segunda: 0 };
        if (f.calidad === 'primera') g.primera += Number(f.cantidad_cajas || 0);
        if (f.calidad === 'segunda') g.segunda += Number(f.cantidad_cajas || 0);
        grupos.set(f.grupo_entrega, g);
      }
      const lista = [...grupos.values()];
      total = `${n(lista.reduce((s, g) => s + g.primera, 0))} primera · ${n(lista.reduce((s, g) => s + g.segunda, 0))} segunda`;
      // Cada entrega lleva su 📲 para mandársela al cliente por WhatsApp.
      lineas = lista.map((g) => ({
        texto: `${g.area} · ${g.destino}: ${n(g.primera)} primera · ${n(g.segunda)} segunda`,
        mensaje: mensajeEntregaWhatsApp({
          finca: finca.nombre,
          area: g.area,
          fecha: hoy,
          entregas: [{ responsable: g.destino, primera: g.primera, segunda: g.segunda, observaciones: g.observaciones }],
        }),
      }));
    }
    const vacia = propias.length === 0;
    return elemento('div', { class: 'fila-registro', style: `display:block${vacia ? ';opacity:0.6' : ''}` }, [
      elemento('div', { style: 'display:flex;justify-content:space-between;gap:8px' }, [
        elemento('strong', { texto: finca.nombre }),
        elemento('strong', { texto: vacia ? 'Sin registros hoy' : total }),
      ]),
      ...lineas.map((l) =>
        l.mensaje
          ? elemento('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px' }, [
              elemento('div', { class: 'fila-registro__subtitulo', texto: l.texto }),
              elemento('button', {
                type: 'button',
                class: 'boton-icono',
                title: 'Enviar por WhatsApp',
                style: 'background:none;flex:none',
                texto: '📲',
                onclick: () => abrirWhatsApp(l.mensaje),
              }),
            ])
          : elemento('div', { class: 'fila-registro__subtitulo', texto: l.texto })
      ),
    ]);
  });

  const contenido = elemento('div', {}, [
    elemento('h3', { style: 'margin:0 0 6px;font-size:0.95rem', texto: `Hoy · ${formatearFecha(hoy)}` }),
    elemento('div', { class: 'lista-registros' }, bloques.length > 0 ? bloques : [elemento('p', { class: 'subtitulo-pantalla', texto: 'Sin fincas para mostrar.' })]),
  ]);

  if (tipo !== 'corta') {
    contenido.appendChild(elemento('h3', { style: 'margin:16px 0 6px;font-size:0.95rem', texto: 'Por semana' }));
    contenido.appendChild(tipo === 'embolse' ? await construirSemanasEmbolse(fincaId) : await construirSemanasEntrega(fincaId));
  }
  return contenido;
}

/** Incidencias sin resolver de todas las fincas (o de la finca actual), las urgentes primero. */
async function construirIncidenciasPendientes(contexto, alIrAIncidencias) {
  const { fincaId } = contexto;
  const [abiertas, fincas, areas] = await Promise.all([incidenciasAbiertas(fincaId), repos.listarTodos('fincas'), repos.listarTodos('areas')]);
  const nombreFinca = Object.fromEntries(fincas.map((f) => [f.id, f.nombre]));
  const nombreArea = Object.fromEntries(areas.map((a) => [a.id, a.nombre]));
  const peso = (i) => (i.prioridad === 'urgente' ? 0 : i.prioridad === 'alta' ? 1 : 2);
  const ordenadas = [...abiertas].sort((a, b) => peso(a) - peso(b) || (a.fecha < b.fecha ? 1 : -1));

  const contenido = elemento('div', {});
  if (ordenadas.length === 0) {
    contenido.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: '✅ No hay incidencias pendientes.' }));
  } else {
    contenido.appendChild(
      elemento(
        'div',
        { class: 'lista-registros' },
        ordenadas.map((i) =>
          elemento('div', { class: 'fila-registro', style: 'display:block' }, [
            elemento('div', { style: 'display:flex;justify-content:space-between;gap:8px' }, [
              elemento('strong', { texto: `${nombreFinca[i.finca_id] ?? 'Finca'} · ${i.tipo ?? ''}` }),
              elemento('span', { class: `fila-registro__valor ${i.prioridad === 'urgente' ? 'tono-alerta' : ''}`, texto: i.prioridad ?? '' }),
            ]),
            elemento('div', { class: 'fila-registro__subtitulo', texto: `${nombreArea[i.area_id] ?? 'Sin área'} · ${formatearFecha(i.fecha)}` }),
            i.descripcion ? elemento('div', { style: 'margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere', texto: i.descripcion }) : null,
          ])
        )
      )
    );
  }
  const boton = elemento('button', { type: 'button', class: 'boton boton--fantasma', style: 'margin-top:10px', texto: 'Abrir Incidencias' });
  boton.addEventListener('click', () => {
    document.querySelector('.panel-info-fondo')?.remove();
    alIrAIncidencias?.();
  });
  contenido.appendChild(boton);
  return contenido;
}

async function abrirDetalle(tipo, contexto, alIrAIncidencias) {
  const etiquetaFinca = await etiquetaFincaParaPanel(contexto.fincaId);
  if (tipo === 'incidencias') {
    mostrarPanel({ titulo: `⚠️ Incidencias pendientes (${etiquetaFinca})`, contenido: await construirIncidenciasPendientes(contexto, alIrAIncidencias) });
    return;
  }
  mostrarPanel({ titulo: `${TITULOS_HOY[tipo]} (${etiquetaFinca})`, contenido: await construirDetalleHoy(tipo, contexto) });
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
  // Las 4 tarjetas son tocables para el administrador: abren lo de HOY
  // finca por finca (y el desglose semanal en embolse/entrega), para no
  // tener que entrar a cada finca a revisarlo. Para los demás roles solo
  // Incidencias abre su módulo, como antes.
  contenedor.appendChild(
    elemento('div', { class: 'seccion-dashboard' }, [
      elemento('h2', { class: 'seccion-dashboard__titulo', texto: 'Resumen general' }),
      elemento('div', { class: 'rejilla-estadisticas' }, [
        tarjetaStat('package', stats.embolsadoHoy.toLocaleString('es-CR'), 'Embolse hoy', '', esAdmin ? () => abrirDetalle('embolse', contexto) : null),
        tarjetaStat('crop', stats.cortadoHoy.toLocaleString('es-CR'), 'Corta hoy', '', esAdmin ? () => abrirDetalle('corta', contexto) : null),
        tarjetaStat('basket', stats.cargaHoy.total.toLocaleString('es-CR'), 'Entrega de carga', '', esAdmin ? () => abrirDetalle('entrega', contexto) : null),
        tarjetaStat('alert', stats.abiertas.length, 'Incidencias pendientes', stats.abiertas.length > 0 ? 'tarjeta-stat--alerta' : '', esAdmin ? () => abrirDetalle('incidencias', contexto, alTocarIncidencias) : alTocarIncidencias),
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
