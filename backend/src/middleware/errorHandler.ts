import type { NextFunction, Request, Response } from 'express';

export function manejadorErrores(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error('[error]', err);
  res.status(500).json({ error: 'Error inesperado del servidor. Intenta de nuevo en unos minutos.' });
}

export function rutaNoEncontrada(_req: Request, res: Response) {
  res.status(404).json({ error: 'Ruta no encontrada' });
}
