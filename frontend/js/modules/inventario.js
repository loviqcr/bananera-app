import { repos } from '../db/repos.js';
import { localdb } from '../db/localdb.js';
import { auth } from './auth.js';
import { elemento, crearFormulario, listaRegistros, mostrarDialogo, hoyISO } from '../ui.js';

const CATEGORIAS_INSUMO = ['fertilizantes', 'herbicidas', 'fungicidas', 'herramientas', 'repuestos', 'materiales', 'otros'];
const TIPOS_EQUIPO = [
  { value: 'bomba', label: 'Bomba' },
  { value: 'motobomba', label: 'Motobomba' },
  { value: 'dosificadora', label: 'Bomba dosificadora' },
  { value: 'herbicida', label: 'Bomba herbicida' },
  { value: 'foliar', label: 'Bomba foliar' },
  { value: 'herramienta', label: 'Herramienta' },
  { value: 'otro', label: 'Otro' },
];
const ESTADOS_EQUIPO = [
  { value: 'operativa', label: '✅ Operativa' },
  { value: 'mantenimiento', label: '🔧 Mantenimiento' },
  { value: 'danada', label: '❌ Dañada' },
  { value: 'fuera_de_servicio', label: '⛔ Fuera de servicio' },
];

function cantidadInsumo(movimientos) {
  return movimientos.reduce((suma, m) => suma + (m.tipo === 'salida' ? -Number(m.cantidad) : Number(m.cantidad)), 0);
}

// -------------------- INSUMOS --------------------

async function renderizarInsumos(contenedor, contexto) {
  contenedor.innerHTML = '';
  if (contexto.fincaId === 'todas') {
    contenedor.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Selecciona una finca específica para ver y administrar su inventario de insumos.' }));
    return;
  }

  const insumos = await repos.listarPorFinca('insumos', contexto.fincaId);
  const bajos = [];
  const filasInfo = [];

  for (const insumo of insumos) {
    const movimientos = await localdb.getPorIndice('movimientos_insumo', 'insumo_id', insumo.id);
    const actual = cantidadInsumo(movimientos.filter((m) => !m.eliminado_at));
    const bajo = actual <= Number(insumo.cantidad_minima || 0);
    if (bajo) bajos.push(insumo);
    filasInfo.push({ insumo, actual, bajo });
  }

  if (bajos.length > 0) {
    contenedor.appendChild(
      elemento('div', { class: 'aviso-offline', style: 'display:block' },
        `⚠️ INVENTARIO BAJO: ${bajos.map((b) => b.nombre).join(', ')}`)
    );
  }

  const form = crearFormulario({
    textoBoton: '+ Registrar insumo',
    campos: [
      { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'text', requerido: true },
      { nombre: 'categoria', etiqueta: 'Categoría', tipo: 'select', requerido: true, opciones: CATEGORIAS_INSUMO.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })) },
      { nombre: 'unidad', etiqueta: 'Unidad (sacos, litros, unidades...)', tipo: 'text', requerido: true },
      { nombre: 'cantidad_minima', etiqueta: 'Cantidad mínima (para la alerta)', tipo: 'number', paso: '0.01', requerido: true },
    ],
    alGuardar: async (valores) => {
      await repos.crear('insumos', {
        finca_id: contexto.fincaId,
        nombre: valores.nombre,
        categoria: valores.categoria,
        unidad: valores.unidad,
        cantidad_minima: Number(valores.cantidad_minima) || 0,
      });
      await renderizarInsumos(contenedor, contexto);
    },
  });
  contenedor.appendChild(form);
  contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Insumos de la finca' }));

  const lista = elemento('div', { class: 'lista-registros' });
  if (filasInfo.length === 0) lista.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Sin insumos registrados todavía.' }));

  for (const { insumo, actual, bajo } of filasInfo) {
    const fila = elemento('div', { class: 'fila-registro' }, [
      elemento('div', {}, [
        elemento('div', { class: 'fila-registro__titulo', texto: insumo.nombre }),
        elemento('div', { class: 'fila-registro__subtitulo', texto: `${insumo.categoria} · mínimo ${insumo.cantidad_minima} ${insumo.unidad}` }),
      ]),
      elemento('div', { class: `fila-registro__valor ${bajo ? 'tono-alerta' : 'tono-verde'}`, texto: `${actual} ${insumo.unidad}` }),
    ]);
    const acciones = elemento('div', { class: 'fila', style: 'margin-top:8px' }, [
      elemento('button', {
        type: 'button', class: 'boton boton--secundario', style: 'min-height:38px;font-size:0.82rem', texto: '+ Entrada',
        onclick: async () => {
          const cantidad = prompt(`Entrada de ${insumo.nombre} — cantidad (${insumo.unidad}):`);
          if (!cantidad || isNaN(Number(cantidad))) return;
          const sesion = await auth.sesionActual();
          await repos.crear('movimientos_insumo', { insumo_id: insumo.id, tipo: 'entrada', cantidad: Number(cantidad), motivo: 'Entrada manual', responsable_id: sesion?.usuario?.id ?? null, fecha: hoyISO() });
          await renderizarInsumos(contenedor, contexto);
        },
      }),
      elemento('button', {
        type: 'button', class: 'boton boton--secundario', style: 'min-height:38px;font-size:0.82rem', texto: '− Salida',
        onclick: async () => {
          const cantidad = prompt(`Salida de ${insumo.nombre} — cantidad (${insumo.unidad}):`);
          if (!cantidad || isNaN(Number(cantidad))) return;
          const sesion = await auth.sesionActual();
          await repos.crear('movimientos_insumo', { insumo_id: insumo.id, tipo: 'salida', cantidad: Number(cantidad), motivo: 'Salida manual', responsable_id: sesion?.usuario?.id ?? null, fecha: hoyISO() });
          await renderizarInsumos(contenedor, contexto);
        },
      }),
    ]);
    const envoltorio = elemento('div', {}, [fila, acciones]);
    lista.appendChild(envoltorio);
  }
  contenedor.appendChild(lista);
}

// -------------------- EQUIPOS --------------------

async function renderizarEquipos(contenedor, contexto) {
  contenedor.innerHTML = '';
  const equipos = await repos.listarPorFinca('equipos', contexto.fincaId);

  if (contexto.fincaId !== 'todas') {
    const form = crearFormulario({
      textoBoton: '+ Registrar equipo',
      campos: [
        { nombre: 'codigo', etiqueta: 'Código (ej. B-001)', tipo: 'text', requerido: true },
        { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'text', requerido: true },
        { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', requerido: true, opciones: TIPOS_EQUIPO },
        { nombre: 'responsable_nombre', etiqueta: 'Responsable', tipo: 'text' },
        { nombre: 'estado', etiqueta: 'Estado', tipo: 'select', requerido: true, opciones: ESTADOS_EQUIPO, valor: 'operativa' },
        { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea' },
      ],
      alGuardar: async (valores) => {
        await repos.crear('equipos', {
          codigo: valores.codigo,
          nombre: valores.nombre,
          tipo: valores.tipo,
          finca_id: contexto.fincaId,
          responsable_nombre: valores.responsable_nombre || null,
          estado: valores.estado,
          fecha_registro: hoyISO(),
          fecha_mantenimiento: null,
          observaciones: valores.observaciones || null,
        });
        await renderizarEquipos(contenedor, contexto);
      },
    });
    contenedor.appendChild(form);
  }

  contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Equipos' }));
  const insigniaEstado = { operativa: 'insignia--verde', mantenimiento: 'insignia--ambar', danada: 'insignia--rojo', fuera_de_servicio: 'insignia--gris' };
  const textoEstado = Object.fromEntries(ESTADOS_EQUIPO.map((e) => [e.value, e.label]));

  const lista = elemento('div', { class: 'lista-registros' });
  if (equipos.length === 0) lista.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Sin equipos registrados todavía.' }));
  for (const eq of equipos) {
    const filaBase = elemento('div', { class: 'fila-registro' }, [
      elemento('div', {}, [
        elemento('div', { class: 'fila-registro__titulo', texto: `${eq.codigo} · ${eq.nombre}` }),
        elemento('div', { class: 'fila-registro__subtitulo', texto: `${eq.responsable_nombre || 'Sin responsable asignado'}` }),
      ]),
      elemento('span', { class: `insignia ${insigniaEstado[eq.estado] ?? 'insignia--gris'}`, texto: textoEstado[eq.estado] ?? eq.estado }),
    ]);
    filaBase.style.cursor = 'pointer';
    filaBase.addEventListener('click', async () => {
      const resultado = await mostrarDialogo({
        titulo: `Actualizar estado — ${eq.codigo}`,
        textoConfirmar: 'Guardar',
        campos: [{ nombre: 'estado', etiqueta: 'Estado', tipo: 'select', opciones: ESTADOS_EQUIPO, valor: eq.estado }],
      });
      if (!resultado) return;
      await repos.editar('equipos', eq.id, { estado: resultado.estado, fecha_mantenimiento: resultado.estado === 'mantenimiento' ? hoyISO() : eq.fecha_mantenimiento });
      await renderizarEquipos(contenedor, contexto);
    });
    lista.appendChild(filaBase);
  }
  contenedor.appendChild(lista);
}

// -------------------- BODEGAS --------------------

async function opcionesBodegas() {
  const bodegas = await repos.listarTodos('bodegas');
  const fincas = await repos.listarTodos('fincas');
  const nombreFinca = Object.fromEntries(fincas.map((f) => [f.id, f.nombre]));
  return bodegas
    .map((b) => ({ value: b.id, label: b.tipo === 'principal' ? b.nombre : `${b.nombre} (${nombreFinca[b.finca_id] ?? 'finca'})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function efectoMovimientoBodega(mov, bodegaIdDelItem) {
  if (mov.tipo === 'entrada') return Number(mov.cantidad);
  if (mov.tipo === 'salida') return -Number(mov.cantidad);
  if (mov.tipo === 'ajuste') return Number(mov.cantidad);
  if (mov.tipo === 'transferencia') {
    if (mov.bodega_origen_id === bodegaIdDelItem) return -Number(mov.cantidad);
    if (mov.bodega_destino_id === bodegaIdDelItem) return Number(mov.cantidad);
  }
  return 0;
}

async function renderizarBodegas(contenedor, contexto) {
  contenedor.innerHTML = '';
  const todasBodegas = await repos.listarTodos('bodegas');
  const bodegaFinca = contexto.fincaId !== 'todas' ? todasBodegas.find((b) => b.finca_id === contexto.fincaId && b.tipo === 'finca') : null;
  const bodegasPrincipales = todasBodegas.filter((b) => b.tipo === 'principal').sort((a, b) => a.nombre.localeCompare(b.nombre));

  const opcionesSelector = [
    ...(bodegaFinca ? [{ value: bodegaFinca.id, label: bodegaFinca.nombre }] : []),
    ...bodegasPrincipales.map((b) => ({ value: b.id, label: b.nombre })),
  ];

  if (opcionesSelector.length === 0) {
    contenedor.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Todavía no hay bodegas sincronizadas en este dispositivo. Conéctate a internet una vez para traerlas.' }));
    return;
  }

  const selector = elemento('select', { class: 'campo', style: 'margin-bottom:14px' });
  for (const op of opcionesSelector) selector.appendChild(elemento('option', { value: op.value }, op.label));
  contenedor.appendChild(elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Bodega activa' }), selector]));

  const zona = elemento('div');
  contenedor.appendChild(zona);

  async function pintarBodega(bodegaId) {
    zona.innerHTML = '';
    const items = (await localdb.getPorIndice('bodega_items', 'bodega_id', bodegaId)).filter((i) => !i.eliminado_at);

    const form = crearFormulario({
      textoBoton: '+ Agregar producto a esta bodega',
      campos: [
        { nombre: 'producto', etiqueta: 'Producto', tipo: 'text', requerido: true },
        { nombre: 'categoria', etiqueta: 'Categoría', tipo: 'select', requerido: true, opciones: CATEGORIAS_INSUMO.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })) },
        { nombre: 'unidad', etiqueta: 'Unidad', tipo: 'text', requerido: true },
      ],
      alGuardar: async (valores) => {
        await repos.crear('bodega_items', { bodega_id: bodegaId, producto: valores.producto, categoria: valores.categoria, unidad: valores.unidad });
        await pintarBodega(bodegaId);
      },
    });
    zona.appendChild(form);

    const lista = elemento('div', { class: 'lista-registros' });
    if (items.length === 0) lista.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Sin productos en esta bodega todavía.' }));

    for (const item of items) {
      const movimientos = (await localdb.getPorIndice('movimientos_bodega', 'bodega_item_id', item.id)).filter((m) => !m.eliminado_at);
      const actual = movimientos.reduce((s, m) => s + efectoMovimientoBodega(m, bodegaId), 0);

      const fila = elemento('div', { class: 'fila-registro' }, [
        elemento('div', {}, [
          elemento('div', { class: 'fila-registro__titulo', texto: item.producto }),
          elemento('div', { class: 'fila-registro__subtitulo', texto: item.categoria }),
        ]),
        elemento('div', { class: 'fila-registro__valor tono-verde', texto: `${actual} ${item.unidad}` }),
      ]);

      const acciones = elemento('div', { class: 'fila', style: 'margin-top:8px' }, [
        elemento('button', {
          type: 'button', class: 'boton boton--secundario', style: 'min-height:38px;font-size:0.8rem', texto: '+ Entrada',
          onclick: async () => {
            const cantidad = prompt(`Entrada de ${item.producto} — cantidad (${item.unidad}):`);
            if (!cantidad || isNaN(Number(cantidad))) return;
            const sesion = await auth.sesionActual();
            await repos.crear('movimientos_bodega', { bodega_item_id: item.id, tipo: 'entrada', cantidad: Number(cantidad), responsable_id: sesion?.usuario?.id ?? null, fecha: hoyISO() });
            await pintarBodega(bodegaId);
          },
        }),
        elemento('button', {
          type: 'button', class: 'boton boton--secundario', style: 'min-height:38px;font-size:0.8rem', texto: '− Salida',
          onclick: async () => {
            const cantidad = prompt(`Salida de ${item.producto} — cantidad (${item.unidad}):`);
            if (!cantidad || isNaN(Number(cantidad))) return;
            const sesion = await auth.sesionActual();
            await repos.crear('movimientos_bodega', { bodega_item_id: item.id, tipo: 'salida', cantidad: Number(cantidad), responsable_id: sesion?.usuario?.id ?? null, fecha: hoyISO() });
            await pintarBodega(bodegaId);
          },
        }),
        elemento('button', {
          type: 'button', class: 'boton boton--fantasma', style: 'min-height:38px;font-size:0.8rem', texto: '🔁 Transferir',
          onclick: async () => {
            const destinos = (await opcionesBodegas()).filter((b) => b.value !== bodegaId);
            const resultado = await mostrarDialogo({
              titulo: `Transferir ${item.producto}`,
              textoConfirmar: 'Transferir',
              campos: [
                { nombre: 'destino', etiqueta: 'Bodega destino', tipo: 'select', opciones: destinos },
                { nombre: 'cantidad', etiqueta: `Cantidad (${item.unidad})`, tipo: 'number', paso: '0.01' },
              ],
            });
            if (!resultado || !resultado.cantidad || isNaN(Number(resultado.cantidad))) return;
            const sesion = await auth.sesionActual();
            const cantidad = Number(resultado.cantidad);
            // Busca o crea el mismo producto en la bodega destino, para
            // llevar un kárdex propio ahí también.
            const itemsDestino = (await localdb.getPorIndice('bodega_items', 'bodega_id', resultado.destino)).filter((i) => !i.eliminado_at && i.producto === item.producto);
            const itemDestino = itemsDestino[0] ?? (await repos.crear('bodega_items', { bodega_id: resultado.destino, producto: item.producto, categoria: item.categoria, unidad: item.unidad }));
            const datosComunes = { tipo: 'transferencia', cantidad, bodega_origen_id: bodegaId, bodega_destino_id: resultado.destino, responsable_id: sesion?.usuario?.id ?? null, fecha: hoyISO() };
            await repos.crear('movimientos_bodega', { ...datosComunes, bodega_item_id: item.id });
            await repos.crear('movimientos_bodega', { ...datosComunes, bodega_item_id: itemDestino.id });
            await pintarBodega(bodegaId);
          },
        }),
      ]);

      lista.appendChild(elemento('div', {}, [fila, acciones]));
    }
    zona.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Productos' }));
    zona.appendChild(lista);
  }

  selector.addEventListener('change', () => pintarBodega(selector.value));
  await pintarBodega(selector.value);
}

export const inventarioModulo = {
  etiqueta: 'Inventario / Bodega',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const pestanas = elemento('div', { class: 'pestanas' });
    const zona = elemento('div');
    contenedor.appendChild(pestanas);
    contenedor.appendChild(zona);

    const tabs = [
      { clave: 'insumos', etiqueta: '🧪 Insumos', render: renderizarInsumos },
      { clave: 'equipos', etiqueta: '🔧 Equipos', render: renderizarEquipos },
      { clave: 'bodegas', etiqueta: '🏭 Bodegas', render: renderizarBodegas },
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
    await activar('insumos');
  },

  async insumosBajos(fincaId) {
    const insumos = fincaId === 'todas' ? await repos.listarTodos('insumos') : await repos.listarPorFinca('insumos', fincaId);
    const resultado = [];
    for (const insumo of insumos) {
      const movimientos = await localdb.getPorIndice('movimientos_insumo', 'insumo_id', insumo.id);
      const actual = cantidadInsumo(movimientos.filter((m) => !m.eliminado_at));
      if (actual <= Number(insumo.cantidad_minima || 0)) resultado.push(insumo);
    }
    return resultado;
  },
};
