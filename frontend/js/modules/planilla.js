import { repos } from '../db/repos.js';
import { localdb } from '../db/localdb.js';
import { elemento, crearFormulario, listaRegistros, formatearFecha, hoyISO } from '../ui.js';

const ESTADOS_ASISTENCIA = [
  { value: 'presente', label: '✓ Presente' },
  { value: 'ausente', label: '❌ Ausente' },
  { value: 'incapacidad', label: '🏥 Incapacidad' },
  { value: 'permiso', label: '📝 Permiso' },
  { value: 'vacaciones', label: '🏖 Vacaciones' },
];
const ICONO_ESTADO = Object.fromEntries(ESTADOS_ASISTENCIA.map((e) => [e.value, e.label.split(' ')[0]]));

async function opcionesAreas(fincaId) {
  const areas = fincaId && fincaId !== 'todas' ? await repos.listarPorFinca('areas', fincaId) : [];
  return areas.sort((a, b) => a.orden - b.orden).map((a) => ({ value: a.id, label: a.nombre }));
}

async function empleadosActivos(fincaId) {
  const filas = await repos.listarPorFinca('empleados', fincaId);
  return filas.filter((e) => e.estado === 'activo').sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Upsert local real: si ya existe asistencia de ese empleado ese día, la edita en vez de duplicarla. */
async function marcarAsistencia(empleadoId, fechaISO, estado) {
  const existentes = await localdb.getPorIndice('asistencia', 'empleado_id', empleadoId);
  const deEseDia = existentes.find((a) => a.fecha === fechaISO && !a.eliminado_at);
  if (deEseDia) {
    // empleado_id/fecha van también en el diff (aunque no cambien) para que
    // el servidor pueda resolver por llave natural si este id local no es
    // el que "ganó" en el servidor (dos dispositivos marcando lo mismo
    // offline) — si no, la edición se perdería en silencio.
    await repos.editar('asistencia', deEseDia.id, { empleado_id: empleadoId, fecha: fechaISO, estado });
  } else {
    await repos.crear('asistencia', { empleado_id: empleadoId, fecha: fechaISO, estado, observaciones: null });
  }
}

async function renderizarEmpleados(contenedor, contexto) {
  contenedor.innerHTML = '';
  const [areas, empleados] = await Promise.all([opcionesAreas(contexto.fincaId), repos.listarPorFinca('empleados', contexto.fincaId)]);

  if (contexto.fincaId !== 'todas') {
    const form = crearFormulario({
      textoBoton: '+ Registrar trabajador',
      campos: [
        { nombre: 'codigo', etiqueta: 'Código', tipo: 'text', requerido: true },
        { nombre: 'nombre', etiqueta: 'Nombre completo', tipo: 'text', requerido: true },
        { nombre: 'area_id', etiqueta: 'Área', tipo: 'select', opciones: areas },
        { nombre: 'puesto', etiqueta: 'Puesto', tipo: 'text' },
        { nombre: 'fecha_ingreso', etiqueta: 'Fecha de ingreso', tipo: 'date', valor: hoyISO() },
      ],
      alGuardar: async (valores) => {
        await repos.crear('empleados', {
          finca_id: contexto.fincaId,
          area_id: valores.area_id || null,
          codigo: valores.codigo,
          nombre: valores.nombre,
          puesto: valores.puesto || null,
          estado: 'activo',
          fecha_ingreso: valores.fecha_ingreso || null,
        });
        await renderizarEmpleados(contenedor, contexto);
      },
    });
    contenedor.appendChild(form);
  }

  contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Trabajadores' }));
  contenedor.appendChild(
    listaRegistros(empleados.filter((e) => e.estado === 'activo'), (e) => ({
      titulo: `${e.codigo} · ${e.nombre}`,
      subtitulo: e.puesto || '',
    }), 'Sin trabajadores registrados todavía.')
  );
}

async function renderizarAsistencia(contenedor, contexto) {
  contenedor.innerHTML = '';
  if (contexto.fincaId === 'todas') {
    contenedor.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Selecciona una finca específica para pasar lista.' }));
    return;
  }

  const empleados = await empleadosActivos(contexto.fincaId);
  const campoFecha = elemento('input', { type: 'date', value: hoyISO(), class: 'campo' });
  contenedor.appendChild(elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Fecha' }), campoFecha]));

  const lista = elemento('div', { class: 'lista-registros' });
  contenedor.appendChild(lista);

  async function pintarLista() {
    lista.innerHTML = '';
    if (empleados.length === 0) {
      lista.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'No hay trabajadores activos registrados en esta finca todavía (agrégalos en la pestaña Trabajadores).' }));
      return;
    }
    for (const empleado of empleados) {
      const registros = await localdb.getPorIndice('asistencia', 'empleado_id', empleado.id);
      const deHoy = registros.find((a) => a.fecha === campoFecha.value && !a.eliminado_at);

      const fila = elemento('div', { class: 'tarjeta', style: 'padding:12px' }, [
        elemento('div', { style: 'font-weight:700;margin-bottom:8px', texto: `${empleado.nombre} ${deHoy ? `— ${ICONO_ESTADO[deHoy.estado]}` : ''}` }),
        elemento(
          'div',
          { style: 'display:flex;gap:6px;flex-wrap:wrap' },
          ESTADOS_ASISTENCIA.map((op) =>
            elemento('button', {
              type: 'button',
              class: `boton ${deHoy?.estado === op.value ? 'boton--primario' : 'boton--secundario'}`,
              style: 'width:auto;min-height:38px;padding:0 12px;font-size:0.8rem',
              texto: op.label,
              onclick: async () => {
                await marcarAsistencia(empleado.id, campoFecha.value, op.value);
                await pintarLista();
              },
            })
          )
        ),
      ]);
      lista.appendChild(fila);
    }
  }

  campoFecha.addEventListener('change', pintarLista);
  await pintarLista();
}

async function renderizarReportes(contenedor, contexto) {
  contenedor.innerHTML = '';
  if (contexto.fincaId === 'todas') {
    contenedor.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Selecciona una finca específica para ver el reporte de asistencia.' }));
    return;
  }

  const inicioMes = `${hoyISO().slice(0, 7)}-01`;
  contenedor.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: `Resumen del mes actual (desde ${formatearFecha(inicioMes)})` }));

  const empleados = await empleadosActivos(contexto.fincaId);
  const lista = elemento('div', { class: 'lista-registros' });

  for (const empleado of empleados) {
    const registros = (await localdb.getPorIndice('asistencia', 'empleado_id', empleado.id)).filter((a) => !a.eliminado_at && a.fecha >= inicioMes);
    const contadores = { presente: 0, ausente: 0, incapacidad: 0, permiso: 0, vacaciones: 0 };
    for (const r of registros) contadores[r.estado] = (contadores[r.estado] ?? 0) + 1;

    lista.appendChild(
      elemento('div', { class: 'fila-registro' }, [
        elemento('div', {}, [
          elemento('div', { class: 'fila-registro__titulo', texto: empleado.nombre }),
          elemento('div', {
            class: 'fila-registro__subtitulo',
            texto: `✓ ${contadores.presente} · ❌ ${contadores.ausente} · 🏥 ${contadores.incapacidad} · 📝 ${contadores.permiso} · 🏖 ${contadores.vacaciones}`,
          }),
        ]),
      ])
    );
  }
  contenedor.appendChild(lista);
}

export const planillaModulo = {
  etiqueta: 'Planilla',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const pestanas = elemento('div', { class: 'pestanas' });
    const zona = elemento('div');
    contenedor.appendChild(pestanas);
    contenedor.appendChild(zona);

    const tabs = [
      { clave: 'asistencia', etiqueta: '📋 Pasar lista', render: renderizarAsistencia },
      { clave: 'empleados', etiqueta: '👷 Trabajadores', render: renderizarEmpleados },
      { clave: 'reportes', etiqueta: '📊 Reporte del mes', render: renderizarReportes },
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
    await activar('asistencia');
  },

  async presentesAusentesHoy(fincaId) {
    if (fincaId === 'todas') {
      const fincas = await repos.listarTodos('fincas');
      let presentes = 0, ausentes = 0;
      for (const f of fincas) {
        const r = await this.presentesAusentesHoy(f.id);
        presentes += r.presentes;
        ausentes += r.ausentes;
      }
      return { presentes, ausentes };
    }
    const empleados = await empleadosActivos(fincaId);
    let presentes = 0, ausentes = 0;
    for (const empleado of empleados) {
      const registros = await localdb.getPorIndice('asistencia', 'empleado_id', empleado.id);
      const deHoy = registros.find((a) => a.fecha === hoyISO() && !a.eliminado_at);
      if (deHoy?.estado === 'presente') presentes += 1;
      else if (deHoy && deHoy.estado !== 'presente') ausentes += 1;
    }
    return { presentes, ausentes };
  },
};
