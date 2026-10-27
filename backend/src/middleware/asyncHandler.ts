import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 5 forwards rejected promises automatically; this keeps handler typing tidy. */
export const handler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
