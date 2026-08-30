import { repos } from '../db/repos.js';
import { auth } from './auth.js';
import { elemento, crearFormulario, listaRegistros, mostrarDialogo, formatearFecha, hoyISO } from '../ui.js';

const TIPOS = ['equipo', 'cultivo', 'riego', 'bodega', 'personal', 'electricidad', 'mantenimiento', 'otro'];
const PRIORIDADES = [
  { value: 'urgente', label: '🔴 Urgente' },
  { value: 'alta', label: '🟠 Alta' },
  { value: 'media', label: '🟡 Media' },
  { value: 'baja', label: '🟢 Baja' },
];
const ESTADOS = [
  { value: 'reportada', label: 'Reportada' },
  { value: 'asignada', label: 'Asignada' },
  { value: 'en_proceso', label: 'En proceso' },
  { value: 'resuelta', label: 'Resuelta' },
  { value: 'cerrada', label: 'Cerrada' },
];
const INSIGNIA_PRIORIDAD = { urgente: 'insignia--rojo', alta: 'insignia--rojo', media: 'insignia--ambar', baja: 'insignia--verde' };
const INSIGNIA_ESTADO = { reportada: 'insignia--gris', asignada: 'insignia--azul', en_proceso: 'insignia--ambar', resuelta: 'insignia--verde', cerrada: 'insignia--gris' };

/**
 * Comprime la foto en el propio navegador (máx. 1000px de lado, JPEG ~70%)
 * antes de convertirla a base64 — así una incidencia con foto no infla
 * demasiado la cola de sincronización ni el cupo de datos móviles del
 * dispositivo.
 */
function comprimirImagen(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer la foto'));
    lector.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxLado = 1000;
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject(new Error('No se pudo procesar la foto'));
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

async function opcionesAreas(fincaId) {
  const areas = fincaId && fincaId !== 'todas' ? await repos.listarPorFinca('areas', fincaId) : [];
  return areas.sort((a, b) => a.orden - b.orden).map((a) => ({ value: a.id, label: a.nombre }));
}

export async function incidenciasAbiertas(fincaId) {
  const filas = await repos.listarPorFinca('incidencias', fincaId);
  return filas.filter((f) => f.estado !== 'resuelta' && f.estado !== 'cerrada');
}

export async function incidenciasUrgentesPendientes(fincaId) {
  const abiertas = await incidenciasAbiertas(fincaId);
  return abiertas.filter((f) => f.prioridad === 'urgente');
}

export const incidenciasModulo = {
  etiqueta: 'Incidencias',
  async render(contenedor, contexto) {
    contenedor.innerHTML = '';
    const [areas, todas] = await Promise.all([opcionesAreas(contexto.fincaId), repos.listarPorFinca('incidencias', contexto.fincaId)]);
    const ordenadas = todas.sort((a, b) => (a.fecha + (a.hora || '') < b.fecha + (b.hora || '') ? 1 : -1));

    const abiertas = ordenadas.filter((f) => f.estado !== 'resuelta' && f.estado !== 'cerrada');
    if (abiertas.length > 0) {
      contenedor.appendChild(
        elemento('div', { class: 'aviso-offline', style: 'display:block' }, `🚨 ${abiertas.length} incidencia(s) abierta(s) pendiente(s)`)
      );
    }

    if (contexto.fincaId !== 'todas') {
      let fotoBase64 = null;
      const previa = elemento('img', { class: 'previa-foto', hidden: 'true' });

      const form = crearFormulario({
        textoBoton: '🚨 Reportar incidencia',
        campos: [
          { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', requerido: true, valor: hoyISO() },
          { nombre: 'hora', etiqueta: 'Hora', tipo: 'time', valor: new Date().toTimeString().slice(0, 5) },
          { nombre: 'area_id', etiqueta: 'Área', tipo: 'select', opciones: areas },
          { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', requerido: true, opciones: TIPOS.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })) },
          { nombre: 'prioridad', etiqueta: 'Prioridad', tipo: 'select', requerido: true, opciones: PRIORIDADES },
          { nombre: 'descripcion', etiqueta: 'Descripción', tipo: 'textarea', requerido: true },
          { nombre: 'foto', etiqueta: 'Fotografía (opcional)', tipo: 'file', accept: 'image/*', capture: 'environment' },
        ],
        alGuardar: async (valores) => {
          const sesion = await auth.sesionActual();
          await repos.crear('incidencias', {
            finca_id: contexto.fincaId,
            area_id: valores.area_id || null,
            fecha: valores.fecha,
            hora: valores.hora || null,
            tipo: valores.tipo,
            descripcion: valores.descripcion,
            foto_url: fotoBase64,
            responsable_id: sesion?.usuario?.id ?? null,
            prioridad: valores.prioridad,
            estado: 'reportada',
          });
          fotoBase64 = null;
          previa.hidden = true;
          await this.render(contenedor, contexto);
        },
      });

      const campoFoto = form.querySelector('#campo-foto');
      if (campoFoto) {
        campoFoto.addEventListener('change', async () => {
          const archivo = campoFoto.files?.[0];
          if (!archivo) return;
          fotoBase64 = await comprimirImagen(archivo);
          previa.src = fotoBase64;
          previa.hidden = false;
        });
        campoFoto.insertAdjacentElement('afterend', previa);
      }

      contenedor.appendChild(form);
    }

    contenedor.appendChild(elemento('h2', { class: 'titulo-pantalla', style: 'font-size:1.1rem', texto: 'Incidencias' }));
    const lista = elemento('div', { class: 'lista-registros' });
    if (ordenadas.length === 0) lista.appendChild(elemento('p', { class: 'subtitulo-pantalla', texto: 'Sin incidencias registradas.' }));

    for (const inc of ordenadas) {
      const fila = elemento('div', { class: 'fila-registro', style: 'cursor:pointer;align-items:flex-start' }, [
        elemento('div', {}, [
          elemento('div', { class: 'fila-registro__titulo', texto: `${formatearFecha(inc.fecha)} · ${inc.tipo}` }),
          elemento('div', { class: 'fila-registro__subtitulo', texto: inc.descripcion }),
          elemento('div', { style: 'margin-top:6px;display:flex;gap:6px;flex-wrap:wrap' }, [
            elemento('span', { class: `insignia ${INSIGNIA_PRIORIDAD[inc.prioridad] ?? 'insignia--gris'}`, texto: PRIORIDADES.find((p) => p.value === inc.prioridad)?.label ?? inc.prioridad }),
            elemento('span', { class: `insignia ${INSIGNIA_ESTADO[inc.estado] ?? 'insignia--gris'}`, texto: ESTADOS.find((e) => e.value === inc.estado)?.label ?? inc.estado }),
          ]),
          inc.foto_url ? elemento('img', { class: 'previa-foto', src: inc.foto_url, style: 'max-height:140px' }) : null,
        ]),
      ]);
      fila.addEventListener('click', async () => {
        const resultado = await mostrarDialogo({
          titulo: 'Actualizar incidencia',
          textoConfirmar: 'Guardar',
          campos: [{ nombre: 'estado', etiqueta: 'Estado', tipo: 'select', opciones: ESTADOS, valor: inc.estado }],
        });
        if (!resultado) return;
        await repos.editar('incidencias', inc.id, { estado: resultado.estado });
        await this.render(contenedor, contexto);
      });
      lista.appendChild(fila);
    }
    contenedor.appendChild(lista);
  },
};
