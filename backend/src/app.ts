import fs from 'fs';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { apiRouter } from './routes/api.js';

export function createApp() {
  const app = express();

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: false, // Allows embedding diagrams and styles
    crossOriginEmbedderPolicy: false,
  }));

  // CORS configuration
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id'],
  }));

  // General API Rate Limiting: 300 requests per 15 minutes per IP
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again after 15 minutes.',
    },
  });
  app.use('/api', limiter);

  // Authentication Rate Limiting: 30 attempts per 15 minutes per IP (Brute-force protection)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts from this IP, please try again after 15 minutes.',
    },
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  // Request parsing with limits
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // API Router
  app.use('/api', apiRouter);

  // Serve static frontend assets in production if built
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  } else {
    // Root endpoint info for standalone API mode
    app.get('/', (_req: Request, res: Response) => {
      res.json({
        name: 'Codebase Explainer AI Backend API',
        status: 'running',
        frontendUrl: 'http://localhost:5173',
        endpoints: {
          health: '/api/health',
          analyze: 'POST /api/repositories/analyze',
        },
        message: 'To use the web application interface, open http://localhost:5173 in your browser.',
      });
    });
  }

  // 404 handler for unmatched API routes
  app.use('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: 'The requested API endpoint does not exist',
    });
  });

  // Global centralized error handler with secret redaction
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
    const isClientError = status < 500;

    // Redact any potential API keys, passwords, or tokens from error messages
    let safeMessage = err.message || 'An internal server error occurred';
    safeMessage = safeMessage
      .replace(/AIza[0-9A-Za-z-_]{16,}/g, '[REDACTED]')
      .replace(/ghp_[a-zA-Z0-9]{36}/g, '[REDACTED]')
      .replace(/gho_[a-zA-Z0-9]{36}/g, '[REDACTED]')
      .replace(/github_pat_[a-zA-Z0-9_]{50,100}/g, '[REDACTED]')
      .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED]')
      .replace(/mongodb(?:\+srv)?:\/\/[^\s@]+@/gi, 'mongodb$1://[REDACTED]@')
      .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]')
      .replace(/Bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]');

    if (status >= 500) {
      console.error('[SERVER ERROR]', safeMessage);
    }

    res.status(status).json({
      error: err.code || (isClientError ? 'CLIENT_ERROR' : 'INTERNAL_SERVER_ERROR'),
      message: safeMessage,
    });
  });

  return app;
}
