import type { Response } from 'express';
import type { ApiMeta, ApiSuccess } from '@steam-analytics/shared';

export function ok<T>(res: Response, data: T, meta?: ApiMeta, status = 200) {
  const body: ApiSuccess<T> = meta ? { data, meta } : { data };
  res.status(status).json(body);
}
