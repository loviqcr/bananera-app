import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { UsuarioAutenticado } from '../types/express';

// jsonwebtoken tipa expiresIn como un literal de duración (ms.StringValue),
// no como string genérico. Como el valor viene de una variable de entorno
// (texto libre validado solo en tiempo de ejecución), se castea aquí una
// única vez en vez de debilitar el tipado en cada llamada a jwt.sign.
const accessTokenOptions = { expiresIn: env.jwtExpiresIn } as jwt.SignOptions;
const refreshTokenOptions = { expiresIn: env.jwtRefreshExpiresIn } as jwt.SignOptions;

export function firmarAccessToken(usuario: UsuarioAutenticado): string {
  return jwt.sign(usuario, env.jwtSecret, accessTokenOptions);
}

export function firmarRefreshToken(usuarioId: string): string {
  return jwt.sign({ id: usuarioId, tipo: 'refresh' }, env.jwtRefreshSecret, refreshTokenOptions);
}

export function verificarAccessToken(token: string): UsuarioAutenticado {
  return jwt.verify(token, env.jwtSecret) as UsuarioAutenticado;
}

export function verificarRefreshToken(token: string): { id: string } {
  return jwt.verify(token, env.jwtRefreshSecret) as { id: string };
}
