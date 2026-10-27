import { analyticsQuerySchema } from '@steam-analytics/shared';
import type { Container } from '../container';
import { handler } from '../middleware/asyncHandler';
import { currentUser } from '../middleware/auth';
import { toIso } from '../lib/firestore';
import { ok } from '../lib/respond';
import type { Library } from '../services/libraryService';

const meta = (lib: Library) => ({ source: 'cache' as const, dataAsOf: toIso(lib.user.lastSuccessfulSyncAt) });

export function analyticsController(c: Container) {
  return {
    overview: handler(async (req, res) => {
      const { dto, lib } = await c.analytics.overview(currentUser(req).uid);
      ok(res, dto, meta(lib));
    }),
    playtime: handler(async (req, res) => {
      const { dto, lib } = await c.analytics.playtime(currentUser(req).uid);
      ok(res, dto, meta(lib));
    }),
    achievements: handler(async (req, res) => {
      const { dto, lib } = await c.analytics.achievements(currentUser(req).uid);
      ok(res, dto, meta(lib));
    }),
    libraryValue: handler(async (req, res) => {
      const { dto, lib } = await c.analytics.libraryValue(currentUser(req).uid);
      ok(res, dto, meta(lib));
    }),
    costEfficiency: handler(async (req, res) => {
      const { basis } = analyticsQuerySchema.parse(req.query);
      const { dto, lib } = await c.analytics.costEfficiency(currentUser(req).uid, basis);
      ok(res, dto, meta(lib));
    }),
  };
}
