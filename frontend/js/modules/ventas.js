import { repos } from '../db/repos.js';
import { auth } from './auth.js';
import { elemento, crearFormulario, listaRegistros, formatearFecha, hoyISO } from '../ui.js';

function formatearMoneda(valor) {
  return `₡${Number(valor || 0).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function opcionesVariedades(tipo) {
  const todas = await repos.listarTodos('variedades');
  return todas.filter((v) => v.tipo === tipo).map((v) => ({ value: v.id, label: v.nombre }));
}

async function opcionesClientes() {
  const clientes = await repos.listarTodos('clientes');
  return clientes.map((c) => ({ value: c.id, label: c.nombre }));
}

async function agregarCliente() {
  const nombre = prompt('Nombre del cliente nuevo:');
  if (!nombre || !nombre.trim()) return null;
  return repos.crear('clientes', { nombre: nombre.trim(), contacto: null });
}

function inicioMesISO() {
  return `${hoyISO().slice(0, 7)}-01`;
}

async function renderizarVenta(tabla, campoCantidad, campoPrecio, etiquetaCantidad, contenedor, contexto) {
  contenedor.innerHTML = '';
  const [variedades, clientes, filas] = await Promise.all([
    opcionesVariedades(tabla === 'ventas_platano' ? 'platano' : 'banano'),
    opcionesClientes(),
    repos.listarPorFinca(tabla, contexto.fincaId),
  ]);
  const ordenadas = filas.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

  const totalMes = ordenadas.filter((f) => f.fecha >= inicioMesISO()).reduce((s, f) => s + Number(f[campoCantidad] || 0) * Number(f[campoPrecio] || 0), 0);
  contenedor.appendChild(
    elemento('div', { class: 'tarjeta estadistica', style: 'margin-bottom:var(--espacio)' }, [
      elemento('div', { class: 'estadistica__valor', texto: formatearMoneda(totalMes) }),
      elemento('div', { class: 'estadistica__etiqueta', texto: 'Vendido este mes' }),
    ])
  );

  if (contexto.fincaId !== 'todas') {
    const clientesDom = document.createElement('div');
    const form = crearFormulario({
      textoBoton: '💰 Registrar venta',
      campos: [
        { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', requerido: true, valor: hoyISO() },
        { nombre: 'variedad_id', etiqueta: 'Variedad', tipo: 'select', opciones: variedades },
        { nombre: campoCantidad, etiqueta: etiquetaCantidad, tipo: 'number', requerido: true },
        { nombre: campoPrecio, etiqueta: `Precio por ${etiquetaCantidad.toLowerCase().replace('cantidad de ', '').replace(/s$/, '')}`, tipo: 'number', paso: '0.0001', requerido: true },
        { nombre: 'cliente_id', etiqueta: 'Cliente', tipo: 'select', opciones: clientes },
        { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea' },
      ],
      alGuardar: async (valores) => {
        const sesion = await auth.sesionActual();
        await repos.crear(tabla, {
          finca_id: contexto.fincaId,
          fecha: valores.fecha,
          variedad_id: valores.variedad_id || null,
          [campoCantidad]: Number(valores[campoCantidad]) || 0,
          [campoPrecio]: Number(valores[campoPrecio]) || 0,
          cliente_id: valores.cliente_id || null,
          responsable_id: sesion?.usuario?.id ?? null,
          observaciones: valores.observaciones || null,
        });
        await renderizarVenta(tabla, campoCantidad, campoPrecio, etiquetaCantidad, contenedor, contexto);
      },
    });
    contenedor.appendChild(form);
    const botonCliente = elemento('button', { type: 'button', class: 'boton boton--fantasma', texto: '+ Nuevo cliente' });
    botonCliente.addEventListener('click', async () => {
      const nuevo = await agregarCliente();
      if (nuevo) await renderizarVenta(tabla, campoCantidad, campoPrecio, etiquetaCantidad, contenedor, contexto);
    });
    contenedor.appendChild(botonCliente);
    contenedor.appendChild(elemento('div', { class: 'espaciador' }));
  }

  const nombreCliente = Object.fromEntries(clientes.map((c) => [c.value, c.label]));
  contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Ventas registradas' }));
  contenedor.appendChild(
    listaRegistros(ordenadas.slice(0, 15), (f) => ({
      titulo: `${formatearFecha(f.fecha)} · ${formatearMoneda(Number(f[campoCantidad] || 0) * Number(f[campoPrecio] || 0))}`,
      subtitulo: `${(f[campoCantidad] || 0).toLocaleString('es-CR')} × ${formatearMoneda(f[campoPrecio])}${f.cliente_id ? ` · ${nombreCliente[f.cliente_id] ?? ''}` : ''}`,
    }))
  );
}

async function renderizarReporteVentas(contenedor, contexto) {
  contenedor.innerHTML = '';
  const [platano, banano] = await Promise.all([
    repos.listarPorFinca('ventas_platano', contexto.fincaId),
    repos.listarPorFinca('ventas_banano', contexto.fincaId),
  ]);

  const totalPlatanoMes = platano.filter((f) => f.fecha >= inicioMesISO()).reduce((s, f) => s + Number(f.cantidad_dedos || 0) * Number(f.precio_por_dedo || 0), 0);
  const totalBananoMes = banano.filter((f) => f.fecha >= inicioMesISO()).reduce((s, f) => s + Number(f.cantidad_manos || 0) * Number(f.precio_por_mano || 0), 0);

  contenedor.appendChild(
    elemento('div', { class: 'rejilla-estadisticas' }, [
      elemento('div', { class: 'tarjeta estadistica' }, [elemento('div', { class: 'estadistica__valor', texto: formatearMoneda(totalPlatanoMes) }), elemento('div', { class: 'estadistica__etiqueta', texto: 'Plátano — mes' })]),
      elemento('div', { class: 'tarjeta estadistica' }, [elemento('div', { class: 'estadistica__valor', texto: formatearMoneda(totalBananoMes) }), elemento('div', { class: 'estadistica__etiqueta', texto: 'Banano — mes' })]),
      elemento('div', { class: 'tarjeta estadistica' }, [elemento('div', { class: 'estadistica__valor', texto: formatearMoneda(totalPlatanoMes + totalBananoMes) }), elemento('div', { class: 'estadistica__etiqueta', texto: 'Total — mes' })]),
    ])
  );

  // Agrupado por cliente (este mes)
  const clientes = Object.fromEntries((await repos.listarTodos('clientes')).map((c) => [c.id, c.nombre]));
  const porCliente = {};
  for (const f of [...platano, ...banano]) {
    if (f.fecha < inicioMesISO()) continue;
    const nombre = clientes[f.cliente_id] ?? 'Sin cliente';
    const total = (Number(f.cantidad_dedos || f.cantidad_manos || 0)) * (Number(f.precio_por_dedo || f.precio_por_mano || 0));
    porCliente[nombre] = (porCliente[nombre] ?? 0) + total;
  }
  contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Por cliente (este mes)' }));
  contenedor.appendChild(
    listaRegistros(
      Object.entries(porCliente).sort((a, b) => b[1] - a[1]).map(([nombre, total]) => ({ nombre, total })),
      (f) => ({ titulo: f.nombre, valor: formatearMoneda(f.total) }),
      'Sin ventas este mes.'
    )
  );
}

export const ventasModulo = {
  etiqueta: 'Ventas',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const pestanas = elemento('div', { class: 'pestanas' });
    const zona = elemento('div');
    contenedor.appendChild(pestanas);
    contenedor.appendChild(zona);

    const tabs = [
      { clave: 'platano', etiqueta: '🍌 Plátano', render: (c, ctx) => renderizarVenta('ventas_platano', 'cantidad_dedos', 'precio_por_dedo', 'Cantidad de dedos', c, ctx) },
      { clave: 'banano', etiqueta: '🍌 Banano', render: (c, ctx) => renderizarVenta('ventas_banano', 'cantidad_manos', 'precio_por_mano', 'Cantidad de manos', c, ctx) },
      { clave: 'reporte', etiqueta: '📊 Reporte', render: renderizarReporteVentas },
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
    await activar('platano');
  },

  async totalVendidoMes(fincaId) {
    const [platano, banano] = await Promise.all([repos.listarPorFinca('ventas_platano', fincaId), repos.listarPorFinca('ventas_banano', fincaId)]);
    const mes = inicioMesISO();
    const totalPlatano = platano.filter((f) => f.fecha >= mes).reduce((s, f) => s + Number(f.cantidad_dedos || 0) * Number(f.precio_por_dedo || 0), 0);
    const totalBanano = banano.filter((f) => f.fecha >= mes).reduce((s, f) => s + Number(f.cantidad_manos || 0) * Number(f.precio_por_mano || 0), 0);
    return totalPlatano + totalBanano;
  },
};
