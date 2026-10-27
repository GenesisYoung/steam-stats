import express from 'express';
import cookieParser from 'cookie-parser';
import type { Container } from './container';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { corsPolicy, limiter, securityHeaders } from './middleware/security';
import { apiRouter, internalRouter } from './routes';

export function createApp(c: Container) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', c.env.TRUST_PROXY);
  app.set('query parser', 'simple');

  app.use(securityHeaders());
  app.use(corsPolicy([c.env.PUBLIC_APP_URL, c.env.PUBLIC_API_URL, ...c.env.CORS_ORIGINS]));
  app.use(express.json({ limit: '32kb' }));
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
