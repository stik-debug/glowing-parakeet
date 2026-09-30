/**
 * ChamaPay API Server
 * Production-oriented Express + TypeScript backend.
 */
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { runMigration, getDb } from './db/index.js';
import { AppError } from './utils/errors.js';
import authRoutes from './routes/auth.routes.js';
import chamaRoutes from './routes/chama.routes.js';

const PORT = parseInt(process.env.APP_PORT || '3000', 10);
const APP_ENV = process.env.APP_ENV || 'development';

// Ensure schema on startup
runMigration();

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(','),
    credentials: true,
  })
);
app.use(express.json({ limit: '100kb' }));

app.use(
  rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', code: 'RATE_LIMIT' },
  })
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', env: APP_ENV, service: 'chamapay' });
});

app.get('/api/plans', (_req, res) => {
  const db = getDb();
  const plans = db
    .prepare(
      `SELECT code, name, price_kes, max_members, description
       FROM subscription_plans WHERE is_active = 1 ORDER BY price_kes`
    )
    .all();
  res.json({
    success: true,
    data: plans,
    note: 'Pricing is per Chama / month, not per member.',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/chamas', chamaRoutes);

// Global error handler — never leak stack traces or SQL in production
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      details: APP_ENV === 'development' ? err.details : undefined,
    });
  }
  console.error('[error]', err);
  res.status(500).json({
    success: false,
    error: APP_ENV === 'development' ? err.message : 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
});

app.listen(PORT, () => {
  console.log(`[chamapay] listening on :${PORT} (${APP_ENV})`);
});
