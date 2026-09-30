/**
 * ChamaPay API Server
 * Production-oriented Express + TypeScript backend.
 */
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { runMigration, getDb, generateId, nowIso } from './db/index.js';
import { AppError } from './utils/errors.js';
import authRoutes from './routes/auth.routes.js';
import chamaRoutes from './routes/chama.routes.js';

// Render (and most hosts) inject PORT — always prefer it
const PORT = parseInt(process.env.PORT || process.env.APP_PORT || '3000', 10);
const APP_ENV = process.env.APP_ENV || 'development';

// Ensure schema + default plans on startup
runMigration();
seedPlansIfNeeded();

function seedPlansIfNeeded(): void {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) as c FROM subscription_plans').get() as { c: number }).c;
  if (count > 0) return;
  const now = nowIso();
  const plans = [
    { code: 'STARTER', name: 'Starter', price_kes: 500, max_members: 15, description: 'Up to 15 members. Per Chama / month.' },
    { code: 'GROWTH', name: 'Growth', price_kes: 1500, max_members: 70, description: 'Up to 70 members. Per Chama / month.' },
    { code: 'BUSINESS', name: 'Business', price_kes: 2000, max_members: 100, description: 'Up to 100 members. Per Chama / month.' },
  ];
  for (const p of plans) {
    db.prepare(
      `INSERT INTO subscription_plans (id, code, name, price_kes, max_members, is_active, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(generateId(), p.code, p.name, p.price_kes, p.max_members, p.description, now, now);
  }
  console.log('[seed] Default subscription plans created');
}

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: '100kb' }));

app.use(
  rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '200', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', code: 'RATE_LIMIT' },
  })
);

/** Root — avoids "Cannot GET /" on the public URL */
app.get('/', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ChamaPay API</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1.25rem;
           line-height: 1.5; color: #0f172a; background: #f8fafc; }
    h1 { color: #065f46; margin-bottom: 0.25rem; }
    .badge { display: inline-block; background: #059669; color: #fff; font-size: 0.75rem;
             padding: 0.15rem 0.5rem; border-radius: 999px; vertical-align: middle; }
    code, a { color: #047857; }
    ul { padding-left: 1.2rem; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem; margin-top: 1.5rem; }
    footer { margin-top: 2rem; font-size: 0.85rem; color: #64748b; }
  </style>
</head>
<body>
  <h1>ChamaPay <span class="badge">${APP_ENV}</span></h1>
  <p>Kenyan Chama management API is running.</p>
  <div class="card">
    <strong>Useful endpoints</strong>
    <ul>
      <li><a href="/health"><code>GET /health</code></a> — health check</li>
      <li><a href="/api/plans"><code>GET /api/plans</code></a> — subscription plans</li>
      <li><code>POST /api/auth/register</code> — register</li>
      <li><code>POST /api/auth/login</code> — login</li>
      <li><code>POST /api/chamas</code> — create chama (auth required)</li>
    </ul>
    <p style="margin:0;font-size:0.9rem;color:#64748b">
      Pricing is <strong>per Chama / month</strong>, not per member.<br/>
      Status: <em>INCOMPLETE MVP</em> — Auth + Chama + member limits vertical.
    </p>
  </div>
  <footer>ChamaPay API · Node ${process.version}</footer>
</body>
</html>`);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', env: APP_ENV, service: 'chamapay', node: process.version });
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

// 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Cannot ${req.method} ${req.path}`,
    code: 'NOT_FOUND',
    hint: 'Try GET / or GET /health or GET /api/plans',
  });
});

// Global error handler — never leak stack traces in production
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[chamapay] listening on 0.0.0.0:${PORT} (${APP_ENV})`);
});
