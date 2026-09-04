import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { authRouter } from './routes/auth.routes';
import { fincasRouter } from './routes/fincas.routes';
import { syncRouter } from './routes/sync.routes';
import { usuariosRouter } from './routes/usuarios.routes';
import { auditoriaRouter } from './routes/auditoria.routes';
import { manejadorErrores, rutaNoEncontrada } from './middleware/errorHandler';
import { pool } from './db/pool';

const app = express();

// Render pone la app detrás de un proxy: sin esto, req.ip (y por lo tanto
// el rate limiting de /auth) ve la IP interna del proxy para todos los
// clientes y los agrupa a todos en el mismo cupo de intentos.
app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
  })
);
app.use(express.json({ limit: '20mb' })); // 20mb: los lotes de sync pueden traer fotos de incidencias en base64

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ estado: 'ok', base_de_datos: 'conectada' });
  } catch {
    res.status(503).json({ estado: 'error', base_de_datos: 'desconectada' });
  }
});

app.use('/auth', authRouter);
app.use('/fincas', fincasRouter);
app.use('/sync', syncRouter);
app.use('/usuarios', usuariosRouter);
app.use('/auditoria', auditoriaRouter);

app.use(rutaNoEncontrada);
app.use(manejadorErrores);

app.listen(env.port, () => {
  console.log(`[servidor] Backend bananera escuchando en el puerto ${env.port}`);
});
