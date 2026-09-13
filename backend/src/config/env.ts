import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa .env (copia .env.example).`);
  }
  return value;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  port: parseInt(process.env.PORT ?? '3000', 10),
  adminUsuario: process.env.ADMIN_USUARIO ?? 'admin',
  adminPassword: required('ADMIN_PASSWORD'),
  adminNombre: process.env.ADMIN_NOMBRE ?? 'Administrador',
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
  // Notificaciones push (Web Push / VAPID). Opcionales a propósito: si no
  // están configuradas, pushService.ts deshabilita el envío sin romper nada
  // más del backend (ver notas ahí).
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || null,
  vapidContactEmail: process.env.VAPID_CONTACT_EMAIL || 'mailto:soporte@cosechaspresbere.com',
};
