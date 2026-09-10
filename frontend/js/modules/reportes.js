import { repos } from '../db/repos.js';
import { localdb } from '../db/localdb.js';
import { elemento, formatearFecha, hoyISO } from '../ui.js';
import { auth } from './auth.js';
import { API_BASE_URL } from '../config.js';

function inicioMesISO() {
  return `${hoyISO().slice(0, 7)}-01`;
}

async function mapaNombres(tabla, campoNombre = 'nombre') {
  const filas = await repos.listarTodos(tabla);
  return Object.fromEntries(filas.map((f) => [f.id, f[campoNombre]]));
}

// Cada reporte declara su tabla, sus columnas (encabezado + cómo leer cada
// fila) y si es finca-scoped, para que el filtro de finca/área/fecha del
// módulo sea el mismo para todos.
async function definicionesReportes() {
  const areas = await mapaNombres('areas');
  const fincas = await mapaNombres('fincas');
  const variedades = await mapaNombres('variedades');
  const clientes = await mapaNombres('clientes');

  return {
    produccion_platano: {
      etiqueta: 'Producción — Plátano', tabla: 'entregas_platano',
      columnas: [
        { titulo: 'Fecha', leer: (f) => formatearFecha(f.fecha) },
        { titulo: 'Finca', leer: (f) => fincas[f.finca_id] ?? '' },
        { titulo: 'Área', leer: (f) => areas[f.area_id] ?? '' },
        { titulo: 'Variedad', leer: (f) => variedades[f.variedad_id] ?? '' },
        { titulo: 'Calidad', leer: (f) => f.calidad ?? '' },
        { titulo: 'Cajas', leer: (f) => f.cantidad_cajas ?? 0 },
        { titulo: 'Dedos', leer: (f) => f.cantidad_dedos ?? 0 },
      ],
      totalizar: (filas) => [{ titulo: 'Total dedos', valor: filas.reduce((s, f) => s + Number(f.cantidad_dedos || 0), 0) }],
    },
    produccion_banano: {
      etiqueta: 'Producción — Banano', tabla: 'entregas_banano',
      columnas: [
        { titulo: 'Fecha', leer: (f) => formatearFecha(f.fecha) },
        { titulo: 'Finca', leer: (f) => fincas[f.finca_id] ?? '' },
        { titulo: 'Área', leer: (f) => areas[f.area_id] ?? '' },
        { titulo: 'Variedad', leer: (f) => variedades[f.variedad_id] ?? '' },
        { titulo: 'Calidad', leer: (f) => f.calidad ?? '' },
        { titulo: 'Cajas', leer: (f) => f.cantidad_cajas ?? 0 },
        { titulo: 'Manos', leer: (f) => f.cantidad_manos ?? 0 },
      ],
      totalizar: (filas) => [{ titulo: 'Total manos', valor: filas.reduce((s, f) => s + Number(f.cantidad_manos || 0), 0) }],
    },
    ventas_platano: {
      etiqueta: 'Ventas — Plátano', tabla: 'ventas_platano',
      columnas: [
        { titulo: 'Fecha', leer: (f) => formatearFecha(f.fecha) },
        { titulo: 'Finca', leer: (f) => fincas[f.finca_id] ?? '' },
        { titulo: 'Cliente', leer: (f) => clientes[f.cliente_id] ?? '' },
        { titulo: 'Dedos', leer: (f) => f.cantidad_dedos ?? 0 },
        { titulo: 'Precio/dedo', leer: (f) => Number(f.precio_por_dedo || 0).toFixed(2) },
        { titulo: 'Total (Q)', leer: (f) => (Number(f.cantidad_dedos || 0) * Number(f.precio_por_dedo || 0)).toFixed(2) },
      ],
      totalizar: (filas) => [{ titulo: 'Total Q', valor: filas.reduce((s, f) => s + Number(f.cantidad_dedos || 0) * Number(f.precio_por_dedo || 0), 0).toFixed(2) }],
    },
    ventas_banano: {
      etiqueta: 'Ventas — Banano', tabla: 'ventas_banano',
      columnas: [
        { titulo: 'Fecha', leer: (f) => formatearFecha(f.fecha) },
        { titulo: 'Finca', leer: (f) => fincas[f.finca_id] ?? '' },
        { titulo: 'Cliente', leer: (f) => clientes[f.cliente_id] ?? '' },
        { titulo: 'Manos', leer: (f) => f.cantidad_manos ?? 0 },
        { titulo: 'Precio/mano', leer: (f) => Number(f.precio_por_mano || 0).toFixed(2) },
        { titulo: 'Total (Q)', leer: (f) => (Number(f.cantidad_manos || 0) * Number(f.precio_por_mano || 0)).toFixed(2) },
      ],
      totalizar: (filas) => [{ titulo: 'Total Q', valor: filas.reduce((s, f) => s + Number(f.cantidad_manos || 0) * Number(f.precio_por_mano || 0), 0).toFixed(2) }],
    },
    incidencias: {
      etiqueta: 'Incidencias', tabla: 'incidencias',
      columnas: [
        { titulo: 'Fecha', leer: (f) => formatearFecha(f.fecha) },
        { titulo: 'Finca', leer: (f) => fincas[f.finca_id] ?? '' },
        { titulo: 'Área', leer: (f) => areas[f.area_id] ?? '' },
        { titulo: 'Tipo', leer: (f) => f.tipo ?? '' },
        { titulo: 'Prioridad', leer: (f) => f.prioridad ?? '' },
        { titulo: 'Estado', leer: (f) => f.estado ?? '' },
        { titulo: 'Descripción', leer: (f) => f.descripcion ?? '' },
      ],
    },
    embolse: {
      etiqueta: 'Embolse', tabla: 'embolse',
      columnas: [
        { titulo: 'Fecha', leer: (f) => formatearFecha(f.fecha) },
        { titulo: 'Finca', leer: (f) => fincas[f.finca_id] ?? '' },
        { titulo: 'Área', leer: (f) => areas[f.area_id] ?? '' },
        { titulo: 'Cantidad', leer: (f) => f.cantidad ?? 0 },
      ],
      totalizar: (filas) => [{ titulo: 'Total', valor: filas.reduce((s, f) => s + Number(f.cantidad || 0), 0) }],
    },
    corta: {
      etiqueta: 'Corta', tabla: 'corta',
      columnas: [
        { titulo: 'Fecha', leer: (f) => formatearFecha(f.fecha) },
        { titulo: 'Finca', leer: (f) => fincas[f.finca_id] ?? '' },
        { titulo: 'Área', leer: (f) => areas[f.area_id] ?? '' },
        { titulo: 'Racimos', leer: (f) => f.racimos_cortados ?? 0 },
      ],
      totalizar: (filas) => [{ titulo: 'Total racimos', valor: filas.reduce((s, f) => s + Number(f.racimos_cortados || 0), 0) }],
    },
  };
}

function descargarArchivo(nombre, contenido, tipoMime) {
  const blob = new Blob([contenido], { type: tipoMime });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

function exportarCSV(definicion, filas) {
  const encabezado = definicion.columnas.map((c) => c.titulo).join(',');
  const cuerpo = filas.map((f) => definicion.columnas.map((c) => `"${String(c.leer(f)).replace(/"/g, '""')}"`).join(',')).join('\n');
  descargarArchivo(`${definicion.etiqueta.toLowerCase().replace(/\s+/g, '-')}.csv`, `${encabezado}\n${cuerpo}`, 'text/csv;charset=utf-8;');
}

function exportarExcel(definicion, filas) {
  if (typeof XLSX === 'undefined') {
    alert('No se pudo cargar el generador de Excel (revisa tu conexión la primera vez que uses esta app).');
    return;
  }
  const datos = [definicion.columnas.map((c) => c.titulo), ...filas.map((f) => definicion.columnas.map((c) => c.leer(f)))];
  const hoja = XLSX.utils.aoa_to_sheet(datos);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Reporte');
  XLSX.writeFile(libro, `${definicion.etiqueta.toLowerCase().replace(/\s+/g, '-')}.xlsx`);
}

async function renderizarAuditoria(contenedor) {
  contenedor.innerHTML = '';
  contenedor.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Quién creó/modificó cada registro — se consulta en línea directamente del servidor (no se descarga a cada dispositivo).' }));

  if (!navigator.onLine) {
    contenedor.appendChild(elemento('p', { class: 'mensaje-error mensaje-error--aviso', texto: '📴 Necesitas conexión a internet para ver la auditoría.' }));
    return;
  }

  const token = await auth.obtenerToken();
  try {
    const respuesta = await fetch(`${API_BASE_URL}/auditoria`, { headers: { Authorization: `Bearer ${token}` } });
    if (!respuesta.ok) throw new Error('El servidor respondió ' + respuesta.status);
    const filas = await respuesta.json();

    const envoltorioTabla = elemento('div', { class: 'tabla-envoltorio' });
    const tabla = elemento('table', { class: 'tabla-reporte' }, [
      elemento('thead', {}, [elemento('tr', {}, ['Fecha', 'Tabla', 'Acción', 'Usuario'].map((t) => elemento('th', {}, t)))]),
      elemento(
        'tbody',
        {},
        filas.map((f) =>
          elemento('tr', {}, [
            elemento('td', {}, new Date(f.fecha).toLocaleString('es-CR')),
            elemento('td', {}, f.tabla),
            elemento('td', {}, f.accion),
            elemento('td', {}, f.usuario_nombre ? `${f.usuario_nombre} (${f.usuario_login})` : '—'),
          ])
        )
      ),
    ]);
    envoltorioTabla.appendChild(tabla);
    contenedor.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: `${filas.length} evento(s) más recientes (máx. 500)` }));
    contenedor.appendChild(envoltorioTabla);
  } catch (error) {
    contenedor.appendChild(elemento('p', { class: 'mensaje-error mensaje-error--error', texto: 'No se pudo cargar la auditoría: ' + error.message }));
  }
}

async function renderizarReportesEstandar(contenedor, contexto) {
  contenedor.innerHTML = '';
  const definiciones = await definicionesReportes();

    const selectorTipo = elemento('select', {});
    for (const [clave, def] of Object.entries(definiciones)) selectorTipo.appendChild(elemento('option', { value: clave }, def.etiqueta));

    const areasFinca = contexto.fincaId !== 'todas' ? await repos.listarPorFinca('areas', contexto.fincaId) : [];
    const selectorArea = elemento('select', {});
    selectorArea.appendChild(elemento('option', { value: '' }, 'Todas las áreas'));
    for (const a of areasFinca.sort((x, y) => x.orden - y.orden)) selectorArea.appendChild(elemento('option', { value: a.id }, a.nombre));

    const campoDesde = elemento('input', { type: 'date', value: inicioMesISO() });
    const campoHasta = elemento('input', { type: 'date', value: hoyISO() });

    const filtros = elemento('div', { class: 'tarjeta no-imprimir' }, [
      elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Tipo de reporte' }), selectorTipo]),
      elemento('div', { class: 'fila' }, [
        elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Desde' }), campoDesde]),
        elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Hasta' }), campoHasta]),
      ]),
      contexto.fincaId !== 'todas' ? elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Área' }), selectorArea]) : null,
    ]);
    contenedor.appendChild(filtros);

    const barraAcciones = elemento('div', { class: 'barra-acciones no-imprimir' }, [
      elemento('button', { type: 'button', class: 'boton boton--secundario', texto: '⬇️ CSV' }),
      elemento('button', { type: 'button', class: 'boton boton--secundario', texto: '⬇️ Excel' }),
      elemento('button', { type: 'button', class: 'boton boton--secundario', texto: '🖨️ PDF (imprimir)' }),
    ]);
    contenedor.appendChild(barraAcciones);

    const zonaResultado = elemento('div');
    contenedor.appendChild(zonaResultado);

    let filasActuales = [];
    let definicionActual = definiciones[selectorTipo.value];

    async function actualizar() {
      definicionActual = definiciones[selectorTipo.value];
      let filas = await repos.listarPorFinca(definicionActual.tabla, contexto.fincaId);
      filas = filas.filter((f) => (!f.fecha || (f.fecha >= campoDesde.value && f.fecha <= campoHasta.value)));
      if (selectorArea.value) filas = filas.filter((f) => f.area_id === selectorArea.value);
      filas.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
      filasActuales = filas;

      zonaResultado.innerHTML = '';
      zonaResultado.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: `${filas.length} registro(s)` }));

      const envoltorioTabla = elemento('div', { class: 'tabla-envoltorio' });
      const tabla = elemento('table', { class: 'tabla-reporte' });
      const thead = elemento('thead', {}, [elemento('tr', {}, definicionActual.columnas.map((c) => elemento('th', {}, c.titulo)))]);
      const tbody = elemento('tbody', {}, filas.map((f) => elemento('tr', {}, definicionActual.columnas.map((c) => elemento('td', {}, String(c.leer(f)))))));
      tabla.appendChild(thead);
      tabla.appendChild(tbody);

      if (definicionActual.totalizar && filas.length > 0) {
        const totales = definicionActual.totalizar(filas);
        const ultimaColumna = definicionActual.columnas.length - 1;
        const filaTotal = elemento(
          'tr',
          {},
          definicionActual.columnas.map((c, i) => {
            if (i === 0) return elemento('td', {}, totales[0]?.titulo ?? '');
            if (i === ultimaColumna) return elemento('td', {}, String(totales[0]?.valor ?? ''));
            return elemento('td', {}, '');
          })
        );
        tabla.appendChild(elemento('tfoot', {}, [filaTotal]));
      }

      envoltorioTabla.appendChild(tabla);
      zonaResultado.appendChild(envoltorioTabla);
    }

    selectorTipo.addEventListener('change', actualizar);
    selectorArea.addEventListener('change', actualizar);
    campoDesde.addEventListener('change', actualizar);
    campoHasta.addEventListener('change', actualizar);

    const [botonCSV, botonExcel, botonPDF] = barraAcciones.children;
    botonCSV.addEventListener('click', () => exportarCSV(definicionActual, filasActuales));
    botonExcel.addEventListener('click', () => exportarExcel(definicionActual, filasActuales));
    botonPDF.addEventListener('click', () => window.print());

    await actualizar();
}

async function renderizarColaSync(contenedor) {
  contenedor.innerHTML = '';
  contenedor.appendChild(
    elemento('p', {
      class: 'subtitulo-pantalla',
      texto: 'Operaciones de este dispositivo que todavía no se subieron al servidor. Las que llevan errores repetidos probablemente nunca se van a resolver solas (por ejemplo, un dato que hace referencia a otro que nunca se guardó) — desde acá se pueden descartar sin perder el resto de la cola.',
    })
  );

  const cola = await localdb.obtenerCola();
  if (cola.length === 0) {
    contenedor.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: '✅ No hay nada pendiente en este dispositivo.' }));
    return;
  }

  for (const item of cola) {
    const tarjeta = elemento('div', { class: 'tarjeta' });
    tarjeta.appendChild(elemento('div', { style: 'font-weight:700' }, `${item.tabla} — ${item.operacion}`));
    tarjeta.appendChild(elemento('div', { class: 'subtitulo-pantalla', style: 'margin:4px 0' }, `id: ${item.id}`));
    if (item.intentos > 0) {
      tarjeta.appendChild(
        elemento('div', { class: 'mensaje-error mensaje-error--error' }, `${item.intentos} intento(s) fallido(s): ${item.ultimoError ?? 'sin detalle'}`)
      );
    }
    const botonDescartar = elemento('button', { type: 'button', class: 'boton boton--fantasma', style: 'color:var(--rojo-500,#ef4444)', texto: '🗑️ Descartar (no reintentar más)' });
    botonDescartar.addEventListener('click', async () => {
      if (!confirm('¿Descartar esta operación? No se va a volver a intentar subir al servidor.')) return;
      await localdb.quitarDeCola(item.clave);
      await renderizarColaSync(contenedor);
    });
    tarjeta.appendChild(botonDescartar);
    contenedor.appendChild(tarjeta);
  }
}

export const reportesModulo = {
  etiqueta: 'Reportes',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const sesion = await auth.sesionActual();
    const esAdmin = sesion?.usuario?.rol === 'administrador';

    if (!esAdmin) {
      await renderizarReportesEstandar(contenedor, contexto);
      return;
    }

    const pestanas = elemento('div', { class: 'pestanas' });
    const zona = elemento('div');
    contenedor.appendChild(pestanas);
    contenedor.appendChild(zona);

    const tabs = [
      { clave: 'reportes', etiqueta: '📊 Reportes', render: renderizarReportesEstandar },
      { clave: 'auditoria', etiqueta: '🕵️ Auditoría', render: (c) => renderizarAuditoria(c) },
      { clave: 'sync', etiqueta: '🔄 Sincronización', render: (c) => renderizarColaSync(c) },
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
    await activar('reportes');
  },
};
