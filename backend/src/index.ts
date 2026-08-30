import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { authRouter } from './routes/auth.routes';
import { fincasRouter } from './routes/fincas.routes';
import { syncRouter } from './routes/sync.routes';
import { usuariosRouter } from './routes/usuarios.routes';
import { manejadorErrores, rutaNoEncontrada } from './middleware/errorHandler';
import { pool } from './db/pool';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
  })
);
app.use(express.json({ limit: '5mb' })); // 5mb: los lotes de sync pueden traer varios registros con observaciones largas

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

app.use(rutaNoEncontrada);
app.use(manejadorErrores);

app.listen(env.port, () => {
  console.log(`[servidor] Backend bananera escuchando en el puerto ${env.port}`);
});
