import type { NextFunction, Request, Response } from 'express';
import { verificarAccessToken } from '../utils/jwt';

/**
 * Exige un JWT válido en el header Authorization: Bearer <token>.
 * En caso de faltar o ser inválido, responde 401 — el cliente offline nunca
 * debería llegar a llamar esto sin token porque el login offline usa el
 * último token guardado localmente y valida su expiración antes de intentar
 * la llamada.
 */
export function requiereAutenticacion(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticación requerido' });
  }
  const token = header.slice('Bearer '.length);
  try {
    req.usuario = verificarAccessToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

/**
 * Restringe el acceso a una lista de roles. Debe usarse después de
 * requiereAutenticacion.
 */
export function requiereRol(...rolesPermitidos: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'Token de autenticación requerido' });
    }
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

/**
 * true si el usuario autenticado tiene acceso a la finca indicada
 * (fincaIds vacío = administrador/bodega, ven todas las fincas).
 */
export function tieneAccesoAFinca(usuario: { rol: string; fincaIds: string[] }, fincaId: string): boolean {
  if (usuario.fincaIds.length === 0) return true;
  return usuario.fincaIds.includes(fincaId);
}
