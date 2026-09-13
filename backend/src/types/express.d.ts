import 'express';

export interface UsuarioAutenticado {
  id: string;
  usuario: string;
  nombre: string;
  rol: string;
  fincaIds: string[]; // fincas a las que tiene acceso; vacío = todas (solo administrador)
}

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
    }
  }
}
