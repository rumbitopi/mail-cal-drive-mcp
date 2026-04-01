/**
 * Bearer token authentication.
 * API key loaded from process.env.API_KEY.
 */

import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual as cryptoTimingSafeEqual, randomBytes } from 'crypto';
import { logger } from '../logger.js';

const PUBLIC_PATHS = new Set([
  '/health',
  '/auth/google/callback',
]);

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path);
}

/**
 * Constant-time string comparison using Node.js crypto.
 * Performs a dummy comparison on length mismatch to avoid leaking length info.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Dummy comparison to keep timing constant
    cryptoTimingSafeEqual(bufA, bufA);
    return false;
  }
  return cryptoTimingSafeEqual(bufA, bufB);
}

/**
 * Validate bearer token from request headers.
 * Returns true if valid, false otherwise.
 */
export function validateBearer(authHeader: string | undefined): boolean {
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey.length < 32) return false;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  return safeCompare(authHeader.slice(7), apiKey);
}

/**
 * Express middleware for bearer auth.
 */
export function bearerAuth() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isPublicPath(req.path)) {
      next();
      return;
    }

    if (!validateBearer(req.headers.authorization)) {
      logger.warn('Bearer auth failed', { path: req.path, ip: req.ip });
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    next();
  };
}
