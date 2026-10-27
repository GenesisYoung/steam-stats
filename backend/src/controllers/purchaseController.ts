import { appIdSchema, purchaseInputSchema, type PurchaseDoc, type PurchaseDto } from '@steam-analytics/shared';
import type { Container } from '../container';
import { handler } from '../middleware/asyncHandler';
import { currentUser } from '../middleware/auth';
import { errors } from '../lib/errors';
import { ok } from '../lib/respond';

export const toPurchaseDto = (p: PurchaseDoc): PurchaseDto => ({
  ...p,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
  userEntered: true,
});

export function purchaseController(c: Container) {
  return {
    list: handler(async (req, res) => {
      const list = await c.purchases.list(currentUser(req).uid);
      ok(res, list.map(toPurchaseDto));
    }),
    upsert: handler(async (req, res) => {
      const { uid } = currentUser(req);
      const appId = appIdSchema.parse(req.params.appid);
      const input = purchaseInputSchema.parse(req.body);
      await c.library.requireLinkedUser(uid);
      if (!(await c.steamData.getGame(uid, appId))) throw errors.notFound('Game not found in your library');
      const doc = await c.purchases.upsert(uid, appId, input);
      await c.users.bumpDataVersion(uid);
      c.library.invalidate(uid);
      ok(res, toPurchaseDto(doc));
    }),
    remove: handler(async (req, res) => {
      const { uid } = currentUser(req);
      const appId = appIdSchema.parse(req.params.appid);
      if (!(await c.purchases.delete(uid, appId))) throw errors.notFound('No purchase recorded for this game');
      await c.users.bumpDataVersion(uid);
      c.library.invalidate(uid);
      res.status(204).end();
    }),
  };
}
