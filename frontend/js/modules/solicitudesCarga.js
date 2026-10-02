import { repos } from '../db/repos.js';
import { auth } from './auth.js';
import { elemento, crearFormulario, tarjetaEstadistica, iconoWhatsApp, formatearFecha, hoyISO } from '../ui.js';
import { abrirWhatsApp } from './entregaCarga.js';

/**
 * Plantilla rápida para que el capataz pida dos cosas que antes se
 * mandaban sueltas por el grupo de WhatsApp:
 *  - "carga": cuántas cajas van para cuál comprador (ej. "100 cajas para
 *    Cenada") — el administrador la verifica y la reenvía al comprador por
 *    WhatsApp con un toque, igual que en Entrega de Carga.
 *  - "empaque": cajas/material de empaque que necesita la finca — es un
 *    pedido interno, no lleva comprador ni se reenvía por WhatsApp.
 */

async function opcionesCompradores() {
  const todos = await repos.listarTodos('responsables_carga');
  return todos.filter((r) => r.activo).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

async function agregarComprador() {
  const nombre = prompt('Nombre del comprador (ej. Cenada, Valerín...):');
  if (!nombre || !nombre.trim()) return null;
  return repos.crear('responsables_carga', { nombre: nombre.trim(), activo: true });
}

/** Mensaje de WhatsApp para reenviarle al comprador el reporte de cajas (solo tipo 'carga'). */
function mensajeSolicitudWhatsApp(s, nombreFinca) {
  const lineas = [
    '*COSECHAS PRESBERE*',
    '_Reporte de pedido de cajas_',
    '',
    `📅 *Fecha:* ${formatearFecha(s.fecha)}`,
    `📍 *Finca:* ${nombreFinca}`,
    `👤 *Para:* ${s.destinatario || 'Comprador'}`,
    `📦 *Cantidad:* ${Number(s.cantidad_cajas || 0).toLocaleString('es-CR')} cajas`,
  ];
  if (s.observaciones) lineas.push(`📝 *Nota:* ${s.observaciones}`);
  lineas.push('', 'Gracias por su preferencia.');
  return lineas.join('\n');
}

function filaSolicitud(s, { nombreFinca, esAdmin, alCambiar }) {
  const atendida = s.estado === 'atendido';
  const esCarga = s.tipo === 'carga';
  const acciones = [];
  if (esAdmin && esCarga && !atendida) {
    acciones.push(
      elemento('button', {
        type: 'button',
        class: 'boton-icono',
        title: 'Enviar por WhatsApp',
        style: 'background:none;flex:none',
        html: iconoWhatsApp(26),
        onclick: () => abrirWhatsApp(mensajeSolicitudWhatsApp(s, nombreFinca[s.finca_id] ?? 'Finca')),
      })
    );
  }
  if (esAdmin && !atendida) {
    acciones.push(
      elemento('button', {
        type: 'button',
        class: 'boton boton--primario',
        style: 'padding:6px 14px;font-size:0.85rem;flex:none;width:auto;min-height:0;border-radius:12px',
        texto: '✓ Atendido',
        onclick: async () => {
          await repos.editar('solicitudes_carga', s.id, { estado: 'atendido' });
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
          if (!confirm('¿Eliminar esta solicitud? No se puede deshacer.')) return;
          await repos.eliminar('solicitudes_carga', s.id);
          await alCambiar();
        },
      })
    );
  }

  const partesSubtitulo = [
    nombreFinca[s.finca_id] ?? 'Finca',
    s.solicitante_nombre || 'Sin nombre',
    formatearFecha(s.fecha),
  ];
  return elemento('div', { class: 'fila-registro', style: 'align-items:flex-start;gap:10px' }, [
    elemento('div', { style: 'flex:1;min-width:0' }, [
      elemento('div', {
        class: 'fila-registro__titulo',
        texto: esCarga
          ? `🚚 ${Number(s.cantidad_cajas || 0).toLocaleString('es-CR')} cajas para ${s.destinatario || 'comprador'}`
          : `📦 ${Number(s.cantidad_cajas || 0).toLocaleString('es-CR')} cajas de empaque`,
      }),
      s.observaciones ? elemento('div', { class: 'fila-registro__subtitulo', texto: s.observaciones }) : null,
      elemento('div', { class: 'fila-registro__subtitulo', texto: partesSubtitulo.join(' · ') }),
    ]),
    elemento('div', { style: 'display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none' }, [
      elemento('div', { class: `fila-registro__valor ${atendida ? 'tono-verde' : 'tono-ambar'}`, texto: atendida ? 'Atendido' : 'Pendiente' }),
      elemento('div', { class: 'fila-registro__acciones' }, acciones),
    ]),
  ]);
}

/** Solicitudes aún no atendidas de `fincaId` ('todas' incluye todas las fincas) — usado por el dashboard de Inicio. */
export async function solicitudesCargaPendientes(fincaId) {
  const todas = await repos.listarPorFinca('solicitudes_carga', fincaId);
  return todas.filter((s) => s.estado !== 'atendido');
}

export const solicitudesCargaModulo = {
  etiqueta: 'Pedir Carga/Empaque',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const [sesion, todas, fincas, compradores] = await Promise.all([
      auth.sesionActual(),
      repos.listarPorFinca('solicitudes_carga', contexto.fincaId),
      repos.listarTodos('fincas'),
      opcionesCompradores(),
    ]);
    const esAdmin = sesion?.usuario?.rol === 'administrador';
    const nombreFinca = Object.fromEntries(fincas.map((f) => [f.id, f.nombre]));
    const ordenadas = todas.sort((a, b) => (a.fecha === b.fecha ? (a.updated_at < b.updated_at ? 1 : -1) : a.fecha < b.fecha ? 1 : -1));
    const pendientes = ordenadas.filter((s) => s.estado !== 'atendido');
    const atendidas = ordenadas.filter((s) => s.estado === 'atendido').slice(0, 15);

    contenedor.appendChild(
      elemento('div', { class: 'rejilla-estadisticas' }, [
        tarjetaEstadistica(pendientes.length, 'Pendientes', pendientes.length > 0 ? 'estadistica--pendiente' : ''),
        tarjetaEstadistica(ordenadas.length - pendientes.length, 'Atendidas'),
      ])
    );

    if (contexto.fincaId === 'todas') {
      contenedor.appendChild(
        elemento('p', { class: 'subtitulo-pantalla', texto: 'Selecciona una finca específica para pedir carga o empaque (estás viendo las de todas).' })
      );
    } else {
      const opcionesComprador = [...compradores.map((c) => ({ value: c.nombre, label: c.nombre })), { value: '__nuevo__', label: '+ Nuevo comprador...' }];
      const form = crearFormulario({
        textoBoton: '📨 Enviar solicitud',
        campos: [
          {
            nombre: 'tipo',
            etiqueta: '¿Qué necesitas?',
            tipo: 'select',
            requerido: true,
            valor: 'carga',
            opciones: [
              { value: 'carga', label: '🚚 Carga — reportar cajas a un comprador' },
              { value: 'empaque', label: '📦 Empaque — pedir cajas/material' },
            ],
          },
          { nombre: 'comprador', etiqueta: 'Comprador', tipo: 'select', opciones: opcionesComprador },
          { nombre: 'cantidad_cajas', etiqueta: 'Cantidad de cajas', tipo: 'number', requerido: true },
          { nombre: 'observaciones', etiqueta: 'Nota (opcional)', tipo: 'textarea' },
        ],
        alGuardar: async (valores) => {
          const esCarga = valores.tipo === 'carga';
          let destinatario = null;
          if (esCarga) {
            if (valores.comprador === '__nuevo__') {
              const nuevo = await agregarComprador();
              if (!nuevo) throw new Error('Escribe el nombre del comprador.');
              destinatario = nuevo.nombre;
            } else if (valores.comprador) {
              destinatario = valores.comprador;
            } else {
              throw new Error('Elige a qué comprador va esta carga.');
            }
          }
          const cantidad = Number(valores.cantidad_cajas);
          if (!cantidad || cantidad <= 0) throw new Error('La cantidad de cajas debe ser mayor que 0.');
          await repos.crear('solicitudes_carga', {
            finca_id: contexto.fincaId,
            fecha: hoyISO(),
            tipo: valores.tipo,
            cantidad_cajas: cantidad,
            destinatario,
            observaciones: (valores.observaciones || '').trim() || null,
            solicitante_id: sesion?.usuario?.id ?? null,
            solicitante_nombre: sesion?.usuario?.nombre ?? null,
            estado: 'pendiente',
          });
          await solicitudesCargaModulo.render(contenedor, contexto);
        },
      });

      // El comprador solo aplica a "carga" — se oculta para "empaque" en vez
      // de mostrar un campo que no significa nada ahí.
      const campoTipo = form.querySelector('[name="tipo"]');
      const campoComprador = form.querySelector('[name="comprador"]');
      const envoltorioComprador = campoComprador?.closest('.campo');
      const actualizarVisibilidadComprador = () => {
        if (envoltorioComprador) envoltorioComprador.hidden = campoTipo.value !== 'carga';
      };
      campoTipo?.addEventListener('change', actualizarVisibilidadComprador);
      actualizarVisibilidadComprador();

      contenedor.appendChild(form);
    }

    const opciones = { nombreFinca, esAdmin, alCambiar: () => solicitudesCargaModulo.render(contenedor, contexto) };

    contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Pendientes' }));
    const listaPendientes = elemento('div', { class: 'lista-registros' });
    if (pendientes.length === 0) listaPendientes.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'No hay solicitudes pendientes.' }));
    for (const s of pendientes) listaPendientes.appendChild(filaSolicitud(s, opciones));
    contenedor.appendChild(listaPendientes);

    if (atendidas.length > 0) {
      contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem;margin-top:16px', texto: 'Atendidas' }));
      const listaAtendidas = elemento('div', { class: 'lista-registros' });
      for (const s of atendidas) listaAtendidas.appendChild(filaSolicitud(s, opciones));
      contenedor.appendChild(listaAtendidas);
    }
  },
};
