import { dotaMatchIdSchema, dotaMatchListQuerySchema, dotaOverviewQuerySchema } from '@steam-analytics/shared';
import type { Container } from '../container';
import { handler } from '../middleware/asyncHandler';
import { currentUser } from '../middleware/auth';
import { ok } from '../lib/respond';

export function dotaController(c: Container) {
  return {
    overview: handler(async (req, res) => {
      const q = dotaOverviewQuerySchema.parse(req.query);
      const { dto, dataAsOf } = await c.dota.overview(currentUser(req).uid, q);
      ok(res, dto, { source: 'cache', dataAsOf });
    }),

    matches: handler(async (req, res) => {
      const q = dotaMatchListQuerySchema.parse(req.query);
      const { dto, total, dataAsOf } = await c.dota.listMatches(currentUser(req).uid, q);
      ok(res, dto, { source: 'cache', dataAsOf, page: q.page, pageSize: q.pageSize, total });
    }),

    match: handler(async (req, res) => {
      const matchId = dotaMatchIdSchema.parse(req.params.matchId);
      ok(res, await c.dota.matchDetail(currentUser(req).uid, matchId), { source: 'cache' });
    }),

    refresh: handler(async (req, res) => {
      await c.dota.refresh(currentUser(req).uid);
      res.status(204).end();
    }),

    requestParse: handler(async (req, res) => {
      const matchId = dotaMatchIdSchema.parse(req.params.matchId);
      await c.dota.requestParse(currentUser(req).uid, matchId);
      ok(res, { requested: true }, undefined, 202);
    }),
  };
}
