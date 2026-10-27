import type { Container } from '../container';
import { handler } from '../middleware/asyncHandler';
import { safeEqual } from '../lib/crypto';
import { errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { ok } from '../lib/respond';

export function internalController(c: Container) {
  return {
    cronSync: handler(async (req, res) => {
      const secret = c.env.CRON_SECRET;
      const provided = req.get('x-cron-secret') ?? '';
      if (!secret || !safeEqual(provided, secret)) throw errors.forbidden();
      const result = await c.sync.runScheduled(25, 12 * 60 * 60 * 1000);
      logger.info('scheduled sync finished', result);
      ok(res, result);
    }),
  };
}
