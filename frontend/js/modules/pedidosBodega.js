import { repos } from '../db/repos.js';
import { auth } from './auth.js';
import { elemento, crearFormulario, tarjetaEstadistica, formatearFecha, hoyISO } from '../ui.js';

function filaPedido(pedido, { nombreFinca, puedeAtender, esAdmin, alCambiar }) {
  const entregado = pedido.estado === 'entregado';
  const acciones = [];
  if (puedeAtender && !entregado) {
    acciones.push(
      elemento('button', {
        type: 'button',
        class: 'boton boton--primario',
        style: 'padding:6px 12px;font-size:0.85rem;flex:none',
        texto: '✓ Entregado',
        onclick: async () => {
          await repos.editar('pedidos_bodega', pedido.id, { estado: 'entregado' });
          await alCambiar();
        },
      })
    );
  }
  if (esAdmin) {
    acciones.push(
      elemento('button', {
        type: 'button',
        class: 'boton-icono',
        title: 'Eliminar',
        style: 'background:none;color:var(--rojo-500);flex:none',
        texto: '🗑️',
        onclick: async () => {
          if (!confirm('¿Eliminar este pedido? No se puede deshacer.')) return;
          await repos.eliminar('pedidos_bodega', pedido.id);
          await alCambiar();
        },
      })
    );
  }
  return elemento('div', { class: 'fila-registro', style: 'align-items:flex-start;gap:10px' }, [
    elemento('div', { style: 'flex:1;min-width:0' }, [
      elemento('div', { class: 'fila-registro__titulo', style: 'white-space:pre-wrap;overflow-wrap:anywhere', texto: pedido.texto }),
      elemento('div', {
        class: 'fila-registro__subtitulo',
        texto: `${nombreFinca[pedido.finca_id] ?? 'Finca'} · ${pedido.solicitante_nombre || 'Sin nombre'} · ${formatearFecha(pedido.fecha)}`,
      }),
    ]),
    elemento('div', { style: 'display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none' }, [
      elemento('div', { class: `fila-registro__valor ${entregado ? 'tono-verde' : 'tono-ambar'}`, texto: entregado ? 'Entregado' : 'Pendiente' }),
      ...acciones,
    ]),
  ]);
}

export const pedidosBodegaModulo = {
  etiqueta: 'Pedidos a bodega',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const [sesion, todos, fincas] = await Promise.all([
      auth.sesionActual(),
      repos.listarPorFinca('pedidos_bodega', contexto.fincaId),
      repos.listarTodos('fincas'),
    ]);
    const rol = sesion?.usuario?.rol;
    const esAdmin = rol === 'administrador';
    const puedeAtender = esAdmin || rol === 'bodega';
    const nombreFinca = Object.fromEntries(fincas.map((f) => [f.id, f.nombre]));
    const ordenados = todos.sort((a, b) => (a.fecha === b.fecha ? (a.updated_at < b.updated_at ? 1 : -1) : a.fecha < b.fecha ? 1 : -1));
    const pendientes = ordenados.filter((p) => p.estado !== 'entregado');
    const entregados = ordenados.filter((p) => p.estado === 'entregado').slice(0, 15);

    contenedor.appendChild(
      elemento('div', { class: 'rejilla-estadisticas' }, [
        tarjetaEstadistica(pendientes.length, 'Pedidos pendientes', pendientes.length > 0 ? 'estadistica--pendiente' : ''),
        tarjetaEstadistica(ordenados.length - pendientes.length, 'Entregados'),
      ])
    );

    if (contexto.fincaId === 'todas') {
      contenedor.appendChild(
        elemento('p', { class: 'subtitulo-pantalla', texto: 'Selecciona una finca específica para enviar un pedido nuevo (estás viendo los de todas).' })
      );
    } else {
      const form = crearFormulario({
        textoBoton: '📦 Enviar pedido',
        campos: [
          { nombre: 'texto', etiqueta: '¿Qué necesitas de la bodega? (ej. bolsas, cinta, mecate, balín...)', tipo: 'textarea', requerido: true },
        ],
        alGuardar: async (valores) => {
          const texto = (valores.texto || '').trim();
          if (!texto) return;
          await repos.crear('pedidos_bodega', {
            finca_id: contexto.fincaId,
            fecha: hoyISO(),
            texto,
            solicitante_id: sesion?.usuario?.id ?? null,
            solicitante_nombre: sesion?.usuario?.nombre ?? null,
            estado: 'pendiente',
          });
          await pedidosBodegaModulo.render(contenedor, contexto);
        },
      });
      contenedor.appendChild(form);
    }

    const opciones = { nombreFinca, puedeAtender, esAdmin, alCambiar: () => pedidosBodegaModulo.render(contenedor, contexto) };

    contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Pendientes' }));
    const listaPendientes = elemento('div', { class: 'lista-registros' });
    if (pendientes.length === 0) listaPendientes.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'No hay pedidos pendientes.' }));
    for (const p of pendientes) listaPendientes.appendChild(filaPedido(p, opciones));
    contenedor.appendChild(listaPendientes);

    if (entregados.length > 0) {
      contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem;margin-top:16px', texto: 'Entregados' }));
      const listaEntregados = elemento('div', { class: 'lista-registros' });
      for (const p of entregados) listaEntregados.appendChild(filaPedido(p, opciones));
      contenedor.appendChild(listaEntregados);
    }
  },
};
