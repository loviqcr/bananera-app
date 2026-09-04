/**
 * Helpers de UI reutilizados por todos los módulos (fases 2-9) para no
 * repetir el mismo código de armar formularios/listas/tarjetas de
 * estadística en cada uno. Todo devuelve nodos DOM planos — sin framework.
 */

export function elemento(tag, props = {}, hijos = []) {
  const nodo = document.createElement(tag);
  for (const [clave, valor] of Object.entries(props)) {
    if (clave === 'class') nodo.className = valor;
    else if (clave === 'texto') nodo.textContent = valor;
    else if (clave === 'html') nodo.innerHTML = valor;
    else if (clave.startsWith('on') && typeof valor === 'function') nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor);
  }
  for (const hijo of [].concat(hijos)) {
    if (hijo == null) continue;
    nodo.appendChild(typeof hijo === 'string' ? document.createTextNode(hijo) : hijo);
  }
  return nodo;
}

/**
 * Construye un <form class="tarjeta"> a partir de una lista de campos.
 * campos: [{ nombre, etiqueta, tipo, opciones, requerido, valor, paso }]
 * tipo: 'text' | 'number' | 'date' | 'time' | 'textarea' | 'select'
 * alGuardar(valores) puede devolver una Promise; mientras corre, el botón
 * se deshabilita para evitar doble-envío (muy común guardando con una sola
 * mano en el campo).
 */
export function crearFormulario({ campos, textoBoton = 'Guardar', alGuardar, limpiarAlGuardar = true }) {
  const form = elemento('form', { class: 'tarjeta' });
  const entradas = {};

  for (const campo of campos) {
    const envoltorio = elemento('div', { class: 'campo' });
    const label = elemento('label', { for: `campo-${campo.nombre}`, texto: campo.etiqueta });
    let entrada;

    if (campo.tipo === 'select') {
      entrada = elemento('select', { id: `campo-${campo.nombre}`, name: campo.nombre });
      if (!campo.requerido) entrada.appendChild(elemento('option', { value: '' }, '—'));
      for (const opcion of campo.opciones ?? []) {
        entrada.appendChild(elemento('option', { value: opcion.value }, opcion.label));
      }
    } else if (campo.tipo === 'textarea') {
      entrada = elemento('textarea', { id: `campo-${campo.nombre}`, name: campo.nombre, rows: '3' });
    } else {
      entrada = elemento('input', {
        id: `campo-${campo.nombre}`,
        name: campo.nombre,
        type: campo.tipo ?? 'text',
      });
      if (campo.paso != null) entrada.setAttribute('step', campo.paso);
    }

    if (campo.requerido) entrada.setAttribute('required', 'true');
    if (campo.valor != null) entrada.value = campo.valor;
    if (campo.accept) entrada.setAttribute('accept', campo.accept);
    if (campo.capture) entrada.setAttribute('capture', campo.capture);

    entradas[campo.nombre] = entrada;
    envoltorio.appendChild(label);
    envoltorio.appendChild(entrada);
    form.appendChild(envoltorio);
  }

  const mensajeError = elemento('div', { class: 'mensaje-error mensaje-error--error' });
  form.appendChild(mensajeError);

  const boton = elemento('button', { type: 'submit', class: 'boton boton--primario', texto: textoBoton });
  form.appendChild(boton);

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mensajeError.textContent = '';
    const valores = {};
    for (const campo of campos) {
      const entrada = entradas[campo.nombre];
      if (entrada.type === 'file') continue; // los campos de archivo se leen aparte (ver módulo de incidencias)
      valores[campo.nombre] = entrada.value;
    }
    boton.disabled = true;
    const textoOriginal = boton.textContent;
    boton.textContent = 'Guardando…';
    try {
      await alGuardar(valores, entradas);
      if (limpiarAlGuardar) form.reset();
    } catch (error) {
      mensajeError.textContent = error.message || 'No se pudo guardar';
    } finally {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  });

  return form;
}

/** Tarjeta chica de estadística (número + etiqueta), para dashboards. */
export function tarjetaEstadistica(valor, etiqueta, tono = '') {
  return elemento('div', { class: `tarjeta estadistica ${tono}` }, [
    elemento('div', { class: 'estadistica__valor', texto: String(valor) }),
    elemento('div', { class: 'estadistica__etiqueta', texto: etiqueta }),
  ]);
}

/** Lista simple de filas con título/subtítulo/valor, más recientes primero. */
export function listaRegistros(filas, formatearFila, vacioTexto = 'Sin registros todavía.') {
  const contenedor = elemento('div', { class: 'lista-registros' });
  if (filas.length === 0) {
    contenedor.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: vacioTexto }));
    return contenedor;
  }
  for (const fila of filas) {
    const { titulo, subtitulo, valor, tono } = formatearFila(fila);
    contenedor.appendChild(
      elemento('div', { class: 'fila-registro' }, [
        elemento('div', {}, [
          elemento('div', { class: 'fila-registro__titulo', texto: titulo }),
          subtitulo ? elemento('div', { class: 'fila-registro__subtitulo', texto: subtitulo }) : null,
        ]),
        valor != null ? elemento('div', { class: `fila-registro__valor ${tono ?? ''}`, texto: String(valor) }) : null,
      ])
    );
  }
  return contenedor;
}

export function formatearFecha(fechaISO) {
  if (!fechaISO) return '';
  const [anio, mes, dia] = fechaISO.slice(0, 10).split('-');
  return `${dia}/${mes}/${anio}`;
}

export function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Cuadro de diálogo pequeño para acciones rápidas que necesitan más de un
 * campo de texto (por eso no alcanza con prompt()) — por ejemplo elegir una
 * bodega destino y una cantidad al transferir inventario. Devuelve una
 * Promise que resuelve con los valores o con null si se cancela.
 */
export function mostrarDialogo({ titulo, campos, textoConfirmar = 'Confirmar' }) {
  return new Promise((resolve) => {
    const fondo = elemento('div', { class: 'dialogo-fondo' });
    const caja = elemento('div', { class: 'dialogo-caja tarjeta' });
    caja.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: titulo }));

    const entradas = {};
    for (const campo of campos) {
      const envoltorio = elemento('div', { class: 'campo' });
      envoltorio.appendChild(elemento('label', { texto: campo.etiqueta }));
      let entrada;
      if (campo.tipo === 'select') {
        entrada = elemento('select', {});
        for (const opcion of campo.opciones ?? []) entrada.appendChild(elemento('option', { value: opcion.value }, opcion.label));
      } else {
        entrada = elemento('input', { type: campo.tipo ?? 'text' });
        if (campo.paso != null) entrada.setAttribute('step', campo.paso);
        if (campo.valor != null) entrada.value = campo.valor;
      }
      entradas[campo.nombre] = entrada;
      envoltorio.appendChild(entrada);
      caja.appendChild(envoltorio);
    }

    const filaBotones = elemento('div', { class: 'fila' });
    const botonCancelar = elemento('button', { type: 'button', class: 'boton boton--fantasma', texto: 'Cancelar' });
    const botonConfirmar = elemento('button', { type: 'button', class: 'boton boton--primario', texto: textoConfirmar });
    filaBotones.appendChild(botonCancelar);
    filaBotones.appendChild(botonConfirmar);
    caja.appendChild(filaBotones);

    function cerrar(valores) {
      fondo.remove();
      resolve(valores);
    }
    botonCancelar.addEventListener('click', () => cerrar(null));
    botonConfirmar.addEventListener('click', () => {
      const valores = {};
      for (const [nombre, entrada] of Object.entries(entradas)) valores[nombre] = entrada.value;
      cerrar(valores);
    });

    fondo.appendChild(caja);
    document.body.appendChild(fondo);
  });
}
