import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { logger, logRequest } from './logger.js';
import { bearerAuth } from './auth/bearer.js';
import { handleMcpPost, handleMcpGet, handleMcpDelete } from './mcp/handler.js';
import { handleGoogleCallback } from './routes/oauth-callback.js';

export function createServer(): Express {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS configuration
  const corsOptions: cors.CorsOptions = {
    origin: config.CORS_ORIGINS
      ? config.CORS_ORIGINS.split(',').map((o) => o.trim())
      : false,
    credentials: true,
  };
  app.use(cors(corsOptions));

  // Body parsing for JSON
  app.use(express.json({ limit: config.MAX_UPLOAD_SIZE }));

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logRequest(req.method, req.path, { ip: req.ip });
    next();
  });

  // Bearer token authentication (skips public paths)
  app.use(bearerAuth());

  // ============================================
  // Public Routes (no auth required)
  // ============================================

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      providers: {
        microsoft: config.MS_ENABLED,
        google: config.GOOGLE_ENABLED,
        imap: config.IMAP_ENABLED,
      },
    });
  });

  // Google OAuth callback (validates state token internally)
  app.get('/auth/google/callback', handleGoogleCallback);

  // ============================================
  // Protected Routes (Bearer token required)
  // ============================================

  // MCP Streamable HTTP endpoints
  app.post('/mcp', handleMcpPost);
  app.get('/mcp', handleMcpGet);
  app.delete('/mcp', handleMcpDelete);

  // ============================================
  // Error Handling
  // ============================================

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error', err);

    const message =
      config.NODE_ENV === 'development' ? err.message : 'Internal server error';

    res.status(500).json({ error: message });
  });

  return app;
}
