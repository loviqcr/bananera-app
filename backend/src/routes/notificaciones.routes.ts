import { Router } from 'express';
import { z } from 'zod';
import { requiereAutenticacion } from '../middleware/auth';
import { guardarSuscripcion, eliminarSuscripcion, clavePublicaVapid, pushHabilitado } from '../services/pushService';

export const notificacionesRouter = Router();

// Pública a propósito: el frontend la necesita ANTES de tener sesión útil
// (justo al pedir permiso de notificaciones) y no expone nada sensible — es
// la mitad pública del par de claves VAPID, hecha para compartirse.
notificacionesRouter.get('/clave-publica', (_req, res) => {
  res.json({ clavePublica: clavePublicaVapid(), disponible: pushHabilitado() });
});

notificacionesRouter.use(requiereAutenticacion);

const suscripcionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

notificacionesRouter.post('/suscribir', async (req, res, next) => {
  try {
    const parsed = suscripcionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Suscripción inválida', detalle: parsed.error.issues });
    }
    await guardarSuscripcion(req.usuario!.id, parsed.data, req.headers['user-agent']);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const eliminarSchema = z.object({ endpoint: z.string().url() });

notificacionesRouter.delete('/suscribir', async (req, res, next) => {
  try {
    const parsed = eliminarSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'endpoint es requerido' });
    await eliminarSuscripcion(parsed.data.endpoint);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
