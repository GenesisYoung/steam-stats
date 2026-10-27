import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@steam-analytics/shared';
import { AppError, UpstreamError } from '../lib/errors';
import { logger } from '../lib/logger';

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
  res.status(404).json(body);
};

/** Converts errors into the consistent API error shape without leaking internals. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let body: ApiErrorBody = { error: { code: 'INTERNAL', message: 'Something went wrong' } };

  if (err instanceof AppError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } };
    if (err.code === 'RATE_LIMITED' && err.details && typeof err.details === 'object' && 'retryAfterSeconds' in err.details) {
      res.setHeader('Retry-After', String(err.details.retryAfterSeconds));
    }
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid request',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    };
  } else if (err instanceof UpstreamError) {
    status = 502;
    body = { error: { code: 'STEAM_UNAVAILABLE', message: 'Steam is temporarily unavailable. Please try again later.' } };
    logger.warn('upstream error', { service: err.service, status: err.status, path: req.path });
  } else if ((err as { type?: string }).type === 'entity.parse.failed') {
    status = 400;
    body = { error: { code: 'VALIDATION_FAILED', message: 'Malformed JSON body' } };
  } else if ((err as { type?: string }).type === 'entity.too.large') {
    status = 413;
    body = { error: { code: 'VALIDATION_FAILED', message: 'Request body too large' } };
  } else {
    logger.error('unhandled error', { path: req.path, method: req.method, error: err });
  }
  res.status(status).json(body);
};
