import { repos } from '../db/repos.js';
import { localdb } from '../db/localdb.js';
import { auth } from './auth.js';
import { elemento, crearFormulario, mostrarDialogo, formatearFecha, hoyISO } from '../ui.js';

const ROLES_VEN_SALARIO = ['administrador', 'planilla'];

function formatearMoneda(valor) {
  return `₡${Number(valor || 0).toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function sumarDiasISO(fechaISO, dias) {
  const fecha = new Date(fechaISO + 'T00:00:00');
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

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

/** Solo se necesita cuando se está viendo "todas las fincas" a la vez, para no confundir de cuál es cada trabajador. */
async function mapaNombresFincas() {
  const fincas = await repos.listarTodos('fincas');
  return Object.fromEntries(fincas.map((f) => [f.id, f.nombre]));
}

/**
 * Un trabajador con al menos un día de asistencia no se puede borrar de
 * verdad: asistencia.empleado_id no tiene ON DELETE CASCADE a propósito
 * (para no perder historial de pagos/reportes), así que el servidor
 * rechazaría el borrado — solo se ofrece "dar de baja" (reversible) en ese
 * caso. Si nunca tuvo asistencia (se registró por error, por ejemplo), sí
 * es seguro eliminarlo por completo.
 */
async function tieneHistorial(empleadoId) {
  const registros = await localdb.getPorIndice('asistencia', 'empleado_id', empleadoId);
  return registros.some((r) => !r.eliminado_at);
}

/** Vacío para cualquier rol que no sea administrador/planilla — ver la nota en syncRegistry.ts. */
async function mapaSalarios() {
  const salarios = await repos.listarTodos('salarios');
  return Object.fromEntries(salarios.map((s) => [s.empleado_id, s]));
}

async function puedeVerSalario() {
  const sesion = await auth.sesionActual();
  return ROLES_VEN_SALARIO.includes(sesion?.usuario?.rol);
}

async function guardarSalario(empleadoId, salarioDiario) {
  const existentes = await localdb.getPorIndice('salarios', 'empleado_id', empleadoId);
  const activo = existentes.find((s) => !s.eliminado_at);
  if (activo) {
    await repos.editar('salarios', activo.id, { empleado_id: empleadoId, salario_diario: salarioDiario });
  } else {
    await repos.crear('salarios', { empleado_id: empleadoId, salario_diario: salarioDiario });
  }
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
  const verSalario = await puedeVerSalario();
  const [areas, empleados, nombreFinca, salarioPorEmpleado] = await Promise.all([
    opcionesAreas(contexto.fincaId),
    repos.listarPorFinca('empleados', contexto.fincaId),
    contexto.fincaId === 'todas' ? mapaNombresFincas() : Promise.resolve(null),
    verSalario ? mapaSalarios() : Promise.resolve(null),
  ]);

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
        // El código de trabajador es único en TODO el sistema, no solo en
        // esta finca (así lo exige el servidor) — se valida acá antes de
        // guardar para no crear localmente un trabajador "fantasma" que el
        // servidor va a rechazar en silencio al sincronizar, dejando
        // huérfano cualquier registro (asistencia, etc.) que lo use después.
        const codigo = valores.codigo.trim();
        const todosLosEmpleados = await repos.listarTodos('empleados');
        const yaExiste = todosLosEmpleados.some((e) => (e.codigo || '').trim().toLowerCase() === codigo.toLowerCase());
        if (yaExiste) {
          throw new Error(`Ya existe un trabajador con el código "${codigo}" (puede ser en otra finca). Usa un código distinto.`);
        }
        await repos.crear('empleados', {
          finca_id: contexto.fincaId,
          area_id: valores.area_id || null,
          codigo,
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
  const activos = empleados.filter((e) => e.estado === 'activo');
  const inactivos = empleados.filter((e) => e.estado !== 'activo');
  const lista = elemento('div', { class: 'lista-registros' });
  if (activos.length === 0) lista.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Sin trabajadores registrados todavía.' }));

  for (const e of activos) {
    const salario = salarioPorEmpleado?.[e.id];
    const sinHistorial = !(await tieneHistorial(e.id));
    const partesSubtitulo = [nombreFinca ? nombreFinca[e.finca_id] ?? 'Finca' : null, e.puesto].filter(Boolean);
    const fila = elemento('div', { class: 'fila-registro' }, [
      elemento('div', verSalario ? { style: 'cursor:pointer', onclick: () => abrirTarifa(e, salario) } : {}, [
        elemento('div', { class: 'fila-registro__titulo', texto: `${e.codigo} · ${e.nombre}` }),
        partesSubtitulo.length ? elemento('div', { class: 'fila-registro__subtitulo', texto: partesSubtitulo.join(' · ') }) : null,
      ]),
      verSalario
        ? elemento('div', {
            class: `fila-registro__valor ${salario ? 'tono-verde' : 'tono-ambar'}`,
            style: 'cursor:pointer',
            texto: salario ? formatearMoneda(salario.salario_diario) + '/día' : 'Sin tarifa',
            onclick: () => abrirTarifa(e, salario),
          })
        : null,
      sinHistorial
        ? elemento('button', {
            type: 'button',
            class: 'boton-icono',
            title: 'Eliminar (nunca tuvo asistencia registrada)',
            style: 'background:none;color:var(--rojo-500);flex:none',
            texto: '🗑️',
            onclick: async () => {
              if (!confirm(`¿Eliminar a ${e.nombre} por completo? No se puede deshacer.`)) return;
              await repos.eliminar('empleados', e.id);
              await renderizarEmpleados(contenedor, contexto);
            },
          })
        : elemento('button', {
            type: 'button',
            class: 'boton-icono',
            title: 'Dar de baja (tiene historial de asistencia, no se puede eliminar)',
            style: 'background:none;color:var(--rojo-500);flex:none',
            texto: '🚫',
            onclick: async () => {
              if (!confirm(`¿Dar de baja a ${e.nombre}? Ya no va a aparecer para pasar lista ni en la planilla, pero su historial se conserva. Se puede reactivar después.`)) return;
              await repos.editar('empleados', e.id, { estado: 'inactivo' });
              await renderizarEmpleados(contenedor, contexto);
            },
          }),
    ]);
    lista.appendChild(fila);
  }
  contenedor.appendChild(lista);

  async function abrirTarifa(empleado, salario) {
    const resultado = await mostrarDialogo({
      titulo: `Tarifa diaria — ${empleado.nombre}`,
      textoConfirmar: 'Guardar',
      campos: [{ nombre: 'salario_diario', etiqueta: 'Salario por día (₡)', tipo: 'number', valor: salario?.salario_diario ?? '' }],
    });
    if (!resultado || resultado.salario_diario === '' || isNaN(Number(resultado.salario_diario))) return;
    await guardarSalario(empleado.id, Number(resultado.salario_diario));
    await renderizarEmpleados(contenedor, contexto);
  }

  if (inactivos.length > 0) {
    const detalles = elemento('details', { style: 'margin-top:14px' }, [
      elemento('summary', { texto: `Dados de baja (${inactivos.length})` }),
    ]);
    const listaInactivos = elemento('div', { class: 'lista-registros', style: 'margin-top:8px' });
    for (const e of inactivos) {
      const partesSubtitulo = [nombreFinca ? nombreFinca[e.finca_id] ?? 'Finca' : null, e.puesto].filter(Boolean);
      listaInactivos.appendChild(
        elemento('div', { class: 'fila-registro' }, [
          elemento('div', {}, [
            elemento('div', { class: 'fila-registro__titulo', texto: `${e.codigo} · ${e.nombre}` }),
            partesSubtitulo.length ? elemento('div', { class: 'fila-registro__subtitulo', texto: partesSubtitulo.join(' · ') }) : null,
          ]),
          elemento('button', {
            type: 'button',
            class: 'boton boton--secundario',
            style: 'width:auto;min-height:34px;padding:0 12px;font-size:0.8rem',
            texto: '↩️ Reactivar',
            onclick: async () => {
              await repos.editar('empleados', e.id, { estado: 'activo' });
              await renderizarEmpleados(contenedor, contexto);
            },
          }),
        ])
      );
    }
    detalles.appendChild(listaInactivos);
    contenedor.appendChild(detalles);
  }
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

/**
 * Pago bruto (sin CCSS/renta ni otros rebajos) = días marcados "presente"
 * en el rango × tarifa diaria configurada en Trabajadores. Solo cuenta
 * "presente" a propósito — incapacidad/permiso/vacaciones no se pagan
 * igual según el caso, así que quien calcule la planilla debe revisarlos
 * aparte y ajustar a mano si corresponde.
 */
async function renderizarCalculoPago(contenedor, contexto) {
  contenedor.innerHTML = '';
  if (!(await puedeVerSalario())) {
    contenedor.appendChild(elemento('p', { class: 'mensaje-error mensaje-error--aviso', texto: 'No tienes permiso para ver esta información.' }));
    return;
  }

  const hoy = hoyISO();
  const campoDesde = elemento('input', { type: 'date', value: sumarDiasISO(hoy, -6) });
  const campoHasta = elemento('input', { type: 'date', value: hoy });

  contenedor.appendChild(
    elemento('p', { class: 'subtitulo-pantalla' }, 'Pago bruto (sin rebajos) según los días marcados "Presente" en Pasar lista, multiplicado por la tarifa diaria de cada trabajador.')
  );
  contenedor.appendChild(
    elemento('div', { class: 'fila' }, [
      elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Desde' }), campoDesde]),
      elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Hasta' }), campoHasta]),
    ])
  );
  const botonCalcular = elemento('button', { type: 'button', class: 'boton boton--primario no-imprimir', texto: '💰 Calcular pago' });
  contenedor.appendChild(botonCalcular);
  contenedor.appendChild(elemento('div', { class: 'espaciador' }));

  const zonaResultado = elemento('div');
  contenedor.appendChild(zonaResultado);

  async function calcular() {
    zonaResultado.innerHTML = '';
    const desde = campoDesde.value;
    const hasta = campoHasta.value;
    if (!desde || !hasta || desde > hasta) {
      zonaResultado.appendChild(elemento('p', { class: 'mensaje-error mensaje-error--error', texto: 'Revisa las fechas: "Desde" debe ser antes o igual que "Hasta".' }));
      return;
    }

    const [empleados, nombreFinca, salarios] = await Promise.all([
      empleadosActivos(contexto.fincaId),
      contexto.fincaId === 'todas' ? mapaNombresFincas() : Promise.resolve(null),
      mapaSalarios(),
    ]);

    let totalGeneral = 0;
    let faltaTarifa = 0;
    const filas = [];
    for (const empleado of empleados) {
      // Por fecha única, no por cantidad de filas: si por algún motivo
      // quedaron dos registros de asistencia para el mismo día (ej. un
      // conflicto de sincronización entre dispositivos que no se limpió),
      // ese día no debe contar doble en el pago.
      const fechasPresente = new Set(
        (await localdb.getPorIndice('asistencia', 'empleado_id', empleado.id))
          .filter((a) => !a.eliminado_at && a.estado === 'presente' && a.fecha >= desde && a.fecha <= hasta)
          .map((a) => a.fecha)
      );
      const dias = fechasPresente.size;
      const tarifa = salarios[empleado.id]?.salario_diario ?? null;
      const total = tarifa != null ? dias * tarifa : null;
      if (tarifa == null && dias > 0) faltaTarifa++;
      if (total != null) totalGeneral += total;
      filas.push({ empleado, dias, tarifa, total });
    }

    zonaResultado.appendChild(elemento('p', { class: 'subtitulo-pantalla' }, `${formatearFecha(desde)} — ${formatearFecha(hasta)}`));

    if (faltaTarifa > 0) {
      zonaResultado.appendChild(
        elemento(
          'div',
          { class: 'aviso-offline', style: 'display:block' },
          `⚠️ ${faltaTarifa} trabajador(es) con días presentes no tienen tarifa configurada — tócalos en "Trabajadores" para ponérsela. No se incluyen en el total de abajo.`
        )
      );
    }

    const lista = elemento('div', { class: 'lista-registros' });
    if (filas.length === 0) lista.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Sin trabajadores activos.' }));
    for (const { empleado, dias, tarifa, total } of filas) {
      const partes = [
        nombreFinca ? nombreFinca[empleado.finca_id] ?? 'Finca' : null,
        `${dias} día(s) presente`,
        tarifa != null ? `${formatearMoneda(tarifa)}/día` : 'sin tarifa configurada',
      ].filter(Boolean);
      lista.appendChild(
        elemento('div', { class: 'fila-registro' }, [
          elemento('div', {}, [
            elemento('div', { class: 'fila-registro__titulo', texto: empleado.nombre }),
            elemento('div', { class: 'fila-registro__subtitulo', texto: partes.join(' · ') }),
          ]),
          elemento('div', { class: `fila-registro__valor ${total == null ? 'tono-ambar' : 'tono-verde'}`, texto: total != null ? formatearMoneda(total) : '—' }),
        ])
      );
    }
    zonaResultado.appendChild(lista);

    zonaResultado.appendChild(
      elemento('div', { class: 'tarjeta estadistica', style: 'margin-top:12px' }, [
        elemento('div', { class: 'estadistica__valor', texto: formatearMoneda(totalGeneral) }),
        elemento('div', { class: 'estadistica__etiqueta', texto: 'Total a pagar (trabajadores con tarifa configurada)' }),
      ])
    );

    const botonImprimir = elemento('button', { type: 'button', class: 'boton boton--secundario no-imprimir', style: 'margin-top:10px', texto: '🖨️ Imprimir' });
    botonImprimir.addEventListener('click', () => window.print());
    zonaResultado.appendChild(botonImprimir);
  }

  botonCalcular.addEventListener('click', calcular);
  await calcular();
}

// Se recuerda fuera de render() porque cada ~30s, al terminar de
// sincronizar en segundo plano, app.js vuelve a llamar render() para
// refrescar los datos — sin esto, ese refresco automático regresaba
// siempre a la primera pestaña aunque el usuario estuviera en otra.
let pestanaGuardada = 'asistencia';

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
    // Aparte porque solo administrador/planilla deben verla — ver la nota
    // en syncRegistry.ts sobre por qué el salario vive en su propia tabla.
    if (await puedeVerSalario()) {
      tabs.push({ clave: 'pago', etiqueta: '💰 Cálculo de pago', render: renderizarCalculoPago });
    }

    async function activar(clave) {
      pestanaGuardada = clave;
      for (const boton of pestanas.children) boton.classList.toggle('pestana--activa', boton.dataset.clave === clave);
      const tab = tabs.find((t) => t.clave === clave);
      await tab.render(zona, contexto);
    }
    for (const tab of tabs) {
      const boton = elemento('button', { type: 'button', class: 'pestana', 'data-clave': tab.clave, texto: tab.etiqueta });
      boton.addEventListener('click', () => activar(tab.clave));
      pestanas.appendChild(boton);
    }
    await activar(tabs.some((t) => t.clave === pestanaGuardada) ? pestanaGuardada : tabs[0].clave);
  },

  async totalActivos(fincaId) {
    if (fincaId === 'todas') {
      const fincas = await repos.listarTodos('fincas');
      let total = 0;
      for (const f of fincas) total += (await empleadosActivos(f.id)).length;
      return total;
    }
    return (await empleadosActivos(fincaId)).length;
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
