import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { getDb, initModels, isPostgres } from './db/connection.js';
import { migrate, migratePg } from './db/migrate.js';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { generalLimiter } from './middleware/rateLimit.js';
import authRoutes from './routes/auth.js';
import leadsRoutes from './routes/leads.js';
import metaRoutes from './routes/meta.js';
import oauthRoutes from './routes/oauth.js';
import capiRoutes from './routes/capi.js';
import dashboardRoutes from './routes/dashboard.js';
import notificationsRoutes from './routes/notifications.js';
import usersRoutes from './routes/users.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API service
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS with production allowlist
const corsOrigin = env.CORS_ORIGIN;
app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Hub-Signature-256'],
  maxAge: 86400
}));

// Body parsers with raw body for webhook HMAC verification
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({
  extended: true,
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use(morgan('dev'));
app.use(generalLimiter);

// Health check (public)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'meta-crm', timestamp: new Date().toISOString() });
});

// Public auth routes
app.use('/api/auth', authRoutes);

// Meta routes (webhook GET/POST public, rest guarded internally)
app.use('/api/meta', metaRoutes);
app.use('/api/meta', oauthRoutes);
app.use('/api/meta', capiRoutes);

// Protected routes
app.use('/api/leads', authMiddleware, leadsRoutes);
app.use('/api/dashboard', authMiddleware, dashboardRoutes);
app.use('/api/notifications', authMiddleware, notificationsRoutes);
app.use('/api/users', authMiddleware, usersRoutes);

// Error handler must be registered last
app.use(errorHandler);

const PORT = process.env.PORT || env.PORT;

async function start() {
  try {
    // Ensure data directory exists for SQLite
    if (!isPostgres()) {
      const dbDir = path.dirname(env.DB_FILE);
      if (dbDir && dbDir !== '.' && !fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
    }

    initModels();
    migrate();

    // Run PostgreSQL migrations if in PG mode
    if (isPostgres()) {
      await migratePg();
    }

    if (env.DEMO_MODE) {
      const db = getDb();
      const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
      if (userCount === 0) {
        const { default: seed } = await import('./db/seed.js');
        await seed();
        console.log('[BOOT] Demo seed executed');
      }
    }

    app.listen(PORT, () => {
      console.log(`[BOOT] Meta CRM Server listening on port ${PORT}`);
      console.log(`[BOOT] Environment: ${env.NODE_ENV}`);
      console.log(`[BOOT] Database: ${isPostgres() ? 'PostgreSQL' : 'SQLite'}`);
    });
  } catch (err) {
    console.error('[BOOT] Failed to start:', err);
    process.exit(1);
  }
}

start();

export { app };
