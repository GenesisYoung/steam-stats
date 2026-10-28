import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { Container } from './container';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { corsPolicy, limiter, securityHeaders, webSecurityHeaders } from './middleware/security';
import { apiRouter, internalRouter } from './routes';

export function createApp(c: Container) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', c.env.TRUST_PROXY);
  app.set('query parser', 'simple');

  if (c.env.FRONTEND_DIST) serveFrontend(app, resolve(c.env.FRONTEND_DIST));

  app.use(securityHeaders());
  app.use(corsPolicy([c.env.PUBLIC_APP_URL, c.env.PUBLIC_API_URL, ...c.env.CORS_ORIGINS]));
  // Spreadsheet imports carry up to a few thousand rows; every other body stays small.
  const smallJson = express.json({ limit: '32kb' });
  const importJson = express.json({ limit: '1mb' });
  app.use((req, res, next) => (req.path.startsWith('/api/purchases/import/') ? importJson : smallJson)(req, res, next));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-cache');
    next();
  });

  app.use('/api', limiter({ windowMs: 15 * 60 * 1000, limit: 1000 }), apiRouter(c));
  app.use('/internal', internalRouter(c));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/**
 * Serve the built SPA from the same origin as the API (Firebase App Hosting).
 * Hashed assets are cached forever; every other non-API GET falls back to index.html.
 */
function serveFrontend(app: Express, dir: string) {
  const indexHtml = resolve(dir, 'index.html');
  if (!existsSync(indexHtml)) throw new Error(`FRONTEND_DIST has no index.html: ${dir}`);
  const isBackendPath = (path: string) => path.startsWith('/api') || path.startsWith('/internal');
  const web = webSecurityHeaders();

  app.use((req, res, next) => (isBackendPath(req.path) ? next() : web(req, res, next)));
  app.use(
    express.static(dir, {
      index: false,
      setHeaders: (res, file) => {
        res.setHeader('Cache-Control', file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  app.use((req, res, next) => {
    // Missing files (paths with an extension) get a real 404 instead of the app shell.
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isBackendPath(req.path) || /\.[a-z0-9]+$/i.test(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}
