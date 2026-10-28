import cors from 'cors';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import type { ApiErrorBody } from '@steam-analytics/shared';

export function securityHeaders(): RequestHandler {
  return helmet({
    // The API only serves JSON and redirects.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  });
}

/** Headers for the single-page app when the API also serves the built frontend (App Hosting). */
export function webSecurityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://apis.google.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://*.steamstatic.com', 'https://*.akamaihd.net', 'https://media.steampowered.com'],
        connectSrc: ["'self'", 'https://*.googleapis.com'],
        frameSrc: ['https://*.firebaseapp.com'],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
}

export function corsPolicy(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return cors({
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
}

const limitBody: ApiErrorBody = { error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down.' } };

export function limiter(opts: { windowMs: number; limit: number; perUser?: boolean }): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => (opts.perUser && req.user ? `u:${req.user.uid}` : ipKeyGenerator(req.ip ?? '0.0.0.0')),
    handler: (_req, res) => res.status(429).json(limitBody),
    // Automated tests replay many sign-ins from one address; app-level limits (sync cooldown) still apply.
    skip: () => process.env.NODE_ENV === 'test',
  });
}
