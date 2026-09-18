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

  // El sync en segundo plano (cada 30s) vuelve a dibujar el módulo entero
  // cuando termina con éxito, para que lleguen cambios de otros dispositivos
  // sin tener que navegar manualmente (ver app.js). Sin marcar el formulario
  // como "sucio", ese refresco automático borraba lo que el usuario llevaba
  // escrito si tardaba más de un ciclo de sync en terminar de llenarlo.
  form.addEventListener('input', () => { form.dataset.sucio = '1'; });
  form.addEventListener('change', () => { form.dataset.sucio = '1'; });

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
      delete form.dataset.sucio;
    } catch (error) {
      mensajeError.textContent = error.message || 'No se pudo guardar';
    } finally {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  });

  return form;
}

/**
 * true si dentro de `contenedor` hay un formulario (de crearFormulario) con
 * cambios sin guardar. Se usa para no pisar la pantalla con un refresco
 * automático de sync mientras el usuario está a medio llenar algo.
 */
export function hayFormularioSinGuardar(contenedor) {
  // Dos formas de quedar "sucio": un descendiente marcado (formularios de
  // crearFormulario(), o un panel armado a mano como usuarios.js), o el
  // propio contenedor (marcarSucio()/limpiarSucio() de abajo — para
  // controles sin formulario real, como los steppers y botones de estado
  // de Entrega de Carga y Mano de Obra).
  return contenedor.dataset.sucio === '1' || !!contenedor.querySelector('[data-sucio="1"]');
}

/**
 * Primitiva genérica para que CUALQUIER módulo marque "hay cambios sin
 * guardar" sin necesidad de un <form> real — steppers, botones de estado,
 * cualquier estado que se guarde en memoria hasta un botón "Guardar"
 * explícito. Sin esto, el refresco automático de sync (cada ~30s o al
 * volver del segundo plano) podía pisar esos cambios porque nunca quedaban
 * marcados como "sucios" (ver la nota de la Fase de Entrega de Carga/Mano
 * de Obra). Llamar a limpiarSucio() justo después de un guardado exitoso.
 */
export function marcarSucio(contenedor) {
  contenedor.dataset.sucio = '1';
}

export function limpiarSucio(contenedor) {
  delete contenedor.dataset.sucio;
}

/** Tarjeta chica de estadística (número + etiqueta), para dashboards. */
export function tarjetaEstadistica(valor, etiqueta, tono = '') {
  return elemento('div', { class: `tarjeta estadistica ${tono}` }, [
    elemento('div', { class: 'estadistica__valor', texto: String(valor) }),
    elemento('div', { class: 'estadistica__etiqueta', texto: etiqueta }),
  ]);
}

/**
 * Set mínimo de iconos de línea (estilo Feather, trazo simple) dibujados a
 * mano en el propio código — sin depender de ninguna librería ni red, igual
 * que el resto de la app. Cada uno es el contenido interno de un <svg
 * viewBox="0 0 24 24">.
 */
const ICONOS_SVG = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M9.5 20v-6h5v6"/>',
  sprout: '<path d="M12 21v-9"/><path d="M12 12C7 12 4.5 8.5 4.5 5c3.3 0 6 1 7.5 4"/><path d="M12 12c4-.3 6.5-3 7.5-7-3.3 0-6.3 1.3-7.5 4.3"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><rect x="7" y="13" width="3" height="6" rx="0.5"/><rect x="13" y="9" width="3" height="10" rx="0.5"/><rect x="18" y="6" width="3" height="13" rx="0.5"/>',
  more: '<circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>',
  package: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  alert: '<path d="M10.6 3.5 2.4 18a1.5 1.5 0 0 0 1.3 2.3h16.6a1.5 1.5 0 0 0 1.3-2.3L13.4 3.5a1.5 1.5 0 0 0-2.8 0Z"/><path d="M12 9.5v4"/><path d="M12 17h.01"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  users: '<circle cx="8.5" cy="8" r="3"/><path d="M2.5 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><circle cx="16.5" cy="9" r="2.3"/><path d="M15 14.2c2.4.5 4.2 2.4 4.2 5.8"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 6.2c0-1.8-2.2-2.9-5-2.9s-5 1.1-5 2.9 2.2 2.6 5 2.9 5 1.1 5 2.9-2.2 2.9-5 2.9-5-1.1-5-2.9"/>',
  crop: '<circle cx="6.2" cy="6.2" r="2.2"/><circle cx="6.2" cy="17.8" r="2.2"/><path d="M19.5 4.5 8 16"/><path d="M14.5 9.5 19.5 14.5"/><path d="M8 8 6.2 6.2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><rect x="9" y="2.3" width="6" height="3.4" rx="1"/><path d="M9 11.5h6"/><path d="M9 15.5h6"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-4 3.4-6.5 7.5-6.5S19.5 16 19.5 20"/>',
  refresh: '<path d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.6"/><path d="M4 4v4.6h4.6"/><path d="M4 12.5a8 8 0 0 0 13.7 4.7L20 15"/><path d="M20 19.6V15h-4.6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  logout: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 16l4-4-4-4"/><path d="M19 12H9"/>',
  repeat: '<path d="M17 2 21 6l-4 4"/><path d="M3 12v-2a4 4 0 0 1 4-4h14"/><path d="M7 22 3 18l4-4"/><path d="M21 12v2a4 4 0 0 1-4 4H3"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  droplet: '<path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3Z"/>',
  farm: '<path d="M4 21V10l8-6 8 6v11"/><path d="M9.5 21v-7h5v7"/><path d="M4 10h16"/>',
  basket: '<path d="M4.5 10h15l-1.6 8.8a2 2 0 0 1-2 1.7H8.1a2 2 0 0 1-2-1.7L4.5 10Z"/><path d="M8.5 10 12 4l3.5 6"/><path d="M9.5 14v3.2"/><path d="M12 14v3.2"/><path d="M14.5 14v3.2"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6"/><path d="M12 18.9v2.6"/><path d="M4.6 4.6l1.8 1.8"/><path d="M17.6 17.6l1.8 1.8"/><path d="M2.5 12h2.6"/><path d="M18.9 12h2.6"/><path d="M4.6 19.4l1.8-1.8"/><path d="M17.6 6.4l1.8-1.8"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16.5V20"/>',
};

/** Devuelve el HTML de un <svg> de línea listo para usar en innerHTML. */
export function icono(nombre, tamano = 20) {
  const contenido = ICONOS_SVG[nombre] || '';
  return `<svg viewBox="0 0 24 24" width="${tamano}" height="${tamano}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${contenido}</svg>`;
}

/**
 * Reemplaza todo elemento marcado con [data-icono] (en cualquier parte del
 * documento, incluido dentro de nodos recién insertados) por el <svg>
 * correspondiente. Se llama una vez al iniciar y de nuevo cada vez que un
 * módulo dibuja markup estático propio con iconos.
 */
export function hidratarIconos(raiz = document) {
  raiz.querySelectorAll?.('[data-icono]').forEach((nodo) => {
    const tamano = Number(nodo.dataset.iconoTam) || 20;
    nodo.innerHTML = icono(nodo.dataset.icono, tamano);
    nodo.removeAttribute('data-icono');
  });
}

/** Tarjeta de estadística con icono circular arriba, para el dashboard. */
export function tarjetaStat(nombreIcono, valor, etiqueta, tono = '', alTocar = null) {
  const props = { class: `tarjeta tarjeta-stat ${tono} ${alTocar ? 'tarjeta-stat--tocable' : ''}`.trim() };
  if (alTocar) {
    props.role = 'button';
    props.tabindex = '0';
    props.onclick = alTocar;
    props.onkeydown = (evento) => {
      if (evento.key === 'Enter' || evento.key === ' ') {
        evento.preventDefault();
        alTocar();
      }
    };
  }
  return elemento('div', props, [
    elemento('div', { class: 'tarjeta-stat__icono', html: icono(nombreIcono, 18) }),
    elemento('div', { class: 'tarjeta-stat__valor', texto: String(valor) }),
    elemento('div', { class: 'tarjeta-stat__etiqueta', texto: etiqueta }),
  ]);
}

/** Lista simple de filas con título/subtítulo/valor, más recientes primero. */
/**
 * opciones.vacioTexto: mensaje cuando no hay filas.
 * opciones.onEliminar(fila): si se pasa, cada fila muestra un botón 🗑️ que
 * pide confirmación y llama a esto — el módulo que llama decide si mostrarlo
 * (normalmente solo para administrador) y qué hacer (repos.eliminar + volver
 * a renderizar). Centralizado acá para que el ícono/confirmación sean
 * siempre los mismos en todos los módulos.
 */
export function listaRegistros(filas, formatearFila, opciones = {}) {
  const { vacioTexto = 'Sin registros todavía.', onEliminar } = opciones;
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
        onEliminar
          ? elemento('button', {
              type: 'button',
              class: 'boton-icono',
              title: 'Eliminar',
              style: 'background:none;color:var(--rojo-500);flex:none',
              texto: '🗑️',
              onclick: async () => {
                if (!confirm('¿Eliminar este registro? No se puede deshacer.')) return;
                await onEliminar(fila);
              },
            })
          : null,
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

let toastActual = null;

/**
 * Aviso flotante dentro de la propia app (el "popup" para cuando se está
 * navegando en el navegador) — se usa para las notificaciones push que
 * llegan con la app abierta. Se cierra solo o al tocarlo.
 */
export function mostrarToast({ titulo, mensaje, alHacerClick }) {
  toastActual?.remove();
  const nodo = elemento('div', { class: 'toast-notificacion', role: 'alert' }, [
    elemento('span', { class: 'toast-notificacion__icono' }, '🚨'),
    elemento('div', { class: 'toast-notificacion__cuerpo' }, [
      elemento('div', { class: 'toast-notificacion__titulo', texto: titulo }),
      mensaje ? elemento('div', { class: 'toast-notificacion__mensaje', texto: mensaje }) : null,
    ]),
  ]);
  nodo.addEventListener('click', () => {
    nodo.remove();
    if (toastActual === nodo) toastActual = null;
    alHacerClick?.();
  });
  document.body.appendChild(nodo);
  toastActual = nodo;
  setTimeout(() => {
    if (nodo.isConnected) nodo.remove();
    if (toastActual === nodo) toastActual = null;
  }, 8000);
}

/**
 * Visor de imagen a pantalla completa (para fotos de incidencias, etc.) —
 * tocar la miniatura para agrandarla, tocar de nuevo en cualquier parte
 * para cerrarla.
 */
export function mostrarImagenAmpliada(src) {
  const overlay = elemento('div', { class: 'visor-imagen' }, [
    elemento('img', { src, alt: '' }),
    elemento('button', { type: 'button', class: 'visor-imagen__cerrar', 'aria-label': 'Cerrar' }, '✕'),
  ]);
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
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
