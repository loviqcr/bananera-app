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

// Los 3 estados de "Mano de Obra" (reemplazan los 5 anteriores). Se
// reutilizan a propósito los mismos valores de estado que ya existían
// ('presente'/'permiso'/'ausente') en vez de inventar unos nuevos — así
// Cálculo de pago, el dashboard ("Personal presente") y el historial de
// Reportes no necesitan ningún cambio para seguir funcionando igual.
// 'incapacidad'/'vacaciones' ya no se pueden elegir desde acá, pero los
// registros históricos con esos valores no se tocan ni se pierden.
const OPCIONES_ASISTENCIA = [
  { value: 'presente', label: 'Asistencia', clase: 'presente' },
  { value: 'permiso', label: 'Ausencia c/permiso', clase: 'permiso' },
  { value: 'ausente', label: 'Ausencia s/permiso', clase: 'ausente' },
];
const HORAS_JORNADA_COMPLETA = 8;

function fechaCorta(fechaISO) {
  const fecha = new Date(fechaISO + 'T00:00:00');
  const texto = fecha.toLocaleDateString('es-CR', { weekday: 'short', day: 'numeric', month: 'short' });
  return texto.charAt(0).toUpperCase() + texto.slice(1).replace('.', '');
}

/** Control +/- de horas trabajadas, arranca en el valor actual (no siempre en 0 como el de Entrega de Carga). */
function crearStepperNumerico(valorInicial, onCambio) {
  let valor = valorInicial;
  const etiquetaValor = elemento('strong', { class: 'stepper__valor', texto: `${valor} h` });
  const botonMenos = elemento('button', {
    type: 'button',
    class: 'boton-stepper',
    texto: '−',
    onclick: () => {
      valor = Math.max(0, valor - 1);
      etiquetaValor.textContent = `${valor} h`;
      onCambio(valor);
    },
  });
  const botonMas = elemento('button', {
    type: 'button',
    class: 'boton-stepper boton-stepper--verde',
    texto: '+',
    onclick: () => {
      valor += 1;
      etiquetaValor.textContent = `${valor} h`;
      onCambio(valor);
    },
  });
  return { contenedor: elemento('div', { class: 'stepper' }, [botonMenos, etiquetaValor, botonMas]) };
}

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

async function esAdministrador() {
  const sesion = await auth.sesionActual();
  return sesion?.usuario?.rol === 'administrador';
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
async function marcarAsistencia(empleadoId, fechaISO, estado, horas) {
  const existentes = await localdb.getPorIndice('asistencia', 'empleado_id', empleadoId);
  const deEseDia = existentes.find((a) => a.fecha === fechaISO && !a.eliminado_at);
  if (deEseDia) {
    // empleado_id/fecha van también en el diff (aunque no cambien) para que
    // el servidor pueda resolver por llave natural si este id local no es
    // el que "ganó" en el servidor (dos dispositivos marcando lo mismo
    // offline) — si no, la edición se perdería en silencio.
    await repos.editar('asistencia', deEseDia.id, { empleado_id: empleadoId, fecha: fechaISO, estado, horas });
  } else {
    await repos.crear('asistencia', { empleado_id: empleadoId, fecha: fechaISO, estado, horas, observaciones: null });
  }
}

async function renderizarEmpleados(contenedor, contexto) {
  contenedor.innerHTML = '';
  const verSalario = await puedeVerSalario();
  const esAdmin = await esAdministrador();
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
        ? (esAdmin
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
                title: 'Dar de baja',
                style: 'background:none;color:var(--rojo-500);flex:none',
                texto: '🚫',
                onclick: async () => {
                  if (!confirm(`¿Dar de baja a ${e.nombre}? Ya no va a aparecer para pasar lista ni en la planilla. Se puede reactivar después.`)) return;
                  await repos.editar('empleados', e.id, { estado: 'inactivo' });
                  await renderizarEmpleados(contenedor, contexto);
                },
              }))
        : elemento('div', { style: 'display:flex;flex:none' }, [
            elemento('button', {
              type: 'button',
              class: 'boton-icono',
              title: 'Dar de baja (recomendado: conserva su historial en Reportes/Cálculo de pago)',
              style: 'background:none;color:var(--rojo-500)',
              texto: '🚫',
              onclick: async () => {
                if (!confirm(`¿Dar de baja a ${e.nombre}? Ya no va a aparecer para pasar lista ni en la planilla, pero su historial se conserva. Se puede reactivar después.`)) return;
                await repos.editar('empleados', e.id, { estado: 'inactivo' });
                await renderizarEmpleados(contenedor, contexto);
              },
            }),
            // Solo administrador: para trabajadores de PRUEBA que ya tienen
            // asistencia marcada por error, "dar de baja" no es suficiente
            // porque el usuario quiere que desaparezca de verdad. Eliminar
            // (soft-delete real, mismo repos.eliminar de siempre) no revienta
            // nada en el servidor, pero SÍ hace que ese trabajador deje de
            // aparecer en los reportes de meses donde sí tuvo asistencia —
            // por eso no se ofrece por defecto a cualquiera, solo admin y con
            // advertencia explícita.
            esAdmin
              ? elemento('button', {
                  type: 'button',
                  class: 'boton-icono',
                  title: 'Eliminar de todas formas (se pierde su historial en Reportes/Cálculo de pago — usar solo con datos de prueba)',
                  style: 'background:none;color:var(--rojo-500)',
                  texto: '🗑️',
                  onclick: async () => {
                    if (!confirm(`¿Eliminar a ${e.nombre} por completo? Tiene asistencia registrada — al eliminarlo, esos días YA NO van a aparecer en Reportes ni en Cálculo de pago de meses pasados. Úsalo solo si es un trabajador de prueba. No se puede deshacer.`)) return;
                    await repos.eliminar('empleados', e.id);
                    await renderizarEmpleados(contenedor, contexto);
                  },
                })
              : null,
          ]),
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

/**
 * "Mano de Obra": a diferencia del resto de la app, acá NO se guarda cada
 * toque al instante — los cambios quedan en memoria (estadoLocal) mientras
 * se marca a todo el mundo, y recién se guardan todos juntos al tocar
 * "Guardar planilla". Sin esto, pasar lista para 10+ trabajadores sería 10+
 * escrituras sueltas en vez de una sola acción clara con confirmación.
 */
async function renderizarAsistencia(contenedor, contexto) {
  contenedor.innerHTML = '';
  if (contexto.fincaId === 'todas') {
    contenedor.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Selecciona una finca específica para pasar lista.' }));
    return;
  }

  const [empleados, fincas] = await Promise.all([empleadosActivos(contexto.fincaId), repos.listarTodos('fincas')]);
  const finca = fincas.find((f) => f.id === contexto.fincaId);

  const campoFecha = elemento('input', { type: 'date', value: hoyISO(), class: 'campo' });
  const estadoLocal = new Map(); // empleado_id -> { estado, horas }

  contenedor.appendChild(
    elemento('div', { class: 'banner-mano-obra' }, [
      elemento('span', { class: 'chip chip--sobre-oscuro', texto: finca?.nombre ?? 'Finca' }),
      elemento('span', { class: 'banner-mano-obra__fecha', id: 'mano-obra-fecha', texto: fechaCorta(campoFecha.value) }),
      elemento('h1', { class: 'banner-mano-obra__titulo', texto: 'Mano de Obra' }),
      elemento('p', { class: 'banner-mano-obra__subtitulo', texto: 'Planilla y asistencia' }),
    ])
  );
  contenedor.appendChild(elemento('div', { class: 'campo' }, [elemento('label', { texto: 'Fecha' }), campoFecha]));

  const resumen = elemento('p', { class: 'subtitulo-pantalla' });
  const lista = elemento('div', { class: 'lista-registros' });
  const mensaje = elemento('div', { class: 'mensaje-error mensaje-error--error' });
  const botonGuardar = elemento('button', { type: 'button', class: 'boton boton--primario', style: 'background:var(--tierra-700)', texto: 'Guardar planilla' });
  const confirmacion = elemento('p', { style: 'color:var(--primario-fuerte);font-weight:700;text-align:center;margin-top:8px' });

  function actualizarResumen() {
    let presente = 0, permiso = 0, ausente = 0;
    for (const { estado } of estadoLocal.values()) {
      if (estado === 'presente') presente++;
      else if (estado === 'permiso') permiso++;
      else if (estado === 'ausente') ausente++;
    }
    resumen.textContent = `${presente} con asistencia · ${permiso} con permiso · ${ausente} sin permiso`;
  }

  function pintarFilaEmpleado(empleado) {
    const local = estadoLocal.get(empleado.id);
    const stepperHoras = crearStepperNumerico(local.horas, (nuevoValor) => {
      local.horas = nuevoValor;
    });

    const filaOpciones = elemento('div', { class: 'opciones-asistencia' });
    function pintarOpciones() {
      filaOpciones.innerHTML = '';
      for (const op of OPCIONES_ASISTENCIA) {
        filaOpciones.appendChild(
          elemento('button', {
            type: 'button',
            class: `opcion-asistencia opcion-asistencia--${op.clase}${local.estado === op.value ? ' opcion-asistencia--activa' : ''}`,
            texto: op.label,
            onclick: () => {
              local.estado = op.value;
              pintarOpciones();
              actualizarResumen();
            },
          })
        );
      }
    }
    pintarOpciones();

    return elemento('div', { class: 'tarjeta', style: 'padding:12px;display:flex;flex-direction:column;gap:10px' }, [
      elemento('div', { class: 'fila', style: 'justify-content:space-between;align-items:center' }, [
        elemento('div', {}, [
          elemento('div', { style: 'font-weight:700', texto: empleado.nombre }),
          empleado.puesto ? elemento('div', { class: 'fila-registro__subtitulo', texto: empleado.puesto }) : null,
        ]),
        stepperHoras.contenedor,
      ]),
      filaOpciones,
    ]);
  }

  async function pintarLista() {
    lista.innerHTML = '';
    confirmacion.textContent = '';
    mensaje.textContent = '';
    document.getElementById('mano-obra-fecha')?.replaceChildren(document.createTextNode(fechaCorta(campoFecha.value)));
    estadoLocal.clear();

    if (empleados.length === 0) {
      lista.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'No hay trabajadores activos registrados en esta finca todavía (agrégalos en la pestaña Trabajadores).' }));
      actualizarResumen();
      return;
    }

    for (const empleado of empleados) {
      const registros = await localdb.getPorIndice('asistencia', 'empleado_id', empleado.id);
      const deEseDia = registros.find((a) => a.fecha === campoFecha.value && !a.eliminado_at);
      estadoLocal.set(empleado.id, {
        estado: deEseDia?.estado ?? 'presente',
        horas: deEseDia?.horas ?? HORAS_JORNADA_COMPLETA,
      });
      lista.appendChild(pintarFilaEmpleado(empleado));
    }
    actualizarResumen();
  }

  botonGuardar.addEventListener('click', async () => {
    mensaje.textContent = '';
    confirmacion.textContent = '';
    botonGuardar.disabled = true;
    try {
      for (const empleado of empleados) {
        const local = estadoLocal.get(empleado.id);
        await marcarAsistencia(empleado.id, campoFecha.value, local.estado, local.horas);
      }
      confirmacion.textContent = 'Planilla guardada ✓';
    } catch (error) {
      mensaje.textContent = error.message || 'No se pudo guardar la planilla';
    } finally {
      botonGuardar.disabled = false;
    }
  });

  campoFecha.addEventListener('change', pintarLista);
  contenedor.appendChild(resumen);
  contenedor.appendChild(lista);
  contenedor.appendChild(mensaje);
  contenedor.appendChild(botonGuardar);
  contenedor.appendChild(confirmacion);
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
    elemento(
      'p',
      { class: 'subtitulo-pantalla' },
      `Pago bruto (sin rebajos) según los días marcados "Asistencia" en Mano de Obra: cada día se paga a prorrata de sus horas sobre una jornada de ${HORAS_JORNADA_COMPLETA}h (ej. medio día de ${HORAS_JORNADA_COMPLETA / 2}h paga la mitad de la tarifa diaria).`
    )
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
      // ese día no debe contar doble en el pago — el último que se procese
      // gana, da igual cuál sea porque en la práctica siempre coinciden.
      const registrosPorFecha = new Map();
      for (const a of await localdb.getPorIndice('asistencia', 'empleado_id', empleado.id)) {
        if (a.eliminado_at || a.estado !== 'presente' || a.fecha < desde || a.fecha > hasta) continue;
        registrosPorFecha.set(a.fecha, a);
      }
      const dias = registrosPorFecha.size;
      // Un día sin horas registradas (asistencia marcada antes de que
      // existiera este campo) se sigue pagando como jornada completa, no
      // como 0 — así el historial previo no pierde valor de golpe.
      let horasTotales = 0;
      for (const a of registrosPorFecha.values()) horasTotales += Number(a.horas ?? HORAS_JORNADA_COMPLETA);
      const tarifa = salarios[empleado.id]?.salario_diario ?? null;
      const total = tarifa != null ? (horasTotales / HORAS_JORNADA_COMPLETA) * tarifa : null;
      if (tarifa == null && dias > 0) faltaTarifa++;
      if (total != null) totalGeneral += total;
      filas.push({ empleado, dias, horasTotales, tarifa, total });
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
    for (const { empleado, dias, horasTotales, tarifa, total } of filas) {
      const partes = [
        nombreFinca ? nombreFinca[empleado.finca_id] ?? 'Finca' : null,
        `${dias} día(s) · ${horasTotales}h`,
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
