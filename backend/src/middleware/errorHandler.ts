import type { NextFunction, Request, Response } from 'express';

export function manejadorErrores(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error('[error]', err);
  const mensaje = err instanceof Error ? err.message : 'Error inesperado del servidor';
  res.status(500).json({ error: mensaje });
}

export function rutaNoEncontrada(_req: Request, res: Response) {
  res.status(404).json({ error: 'Ruta no encontrada' });
}
