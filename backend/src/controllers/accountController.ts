import { updateMeSchema } from '@steam-analytics/shared';
import type { Container } from '../container';
import { handler } from '../middleware/asyncHandler';
import { currentUser } from '../middleware/auth';
import { ok } from '../lib/respond';

export function accountController(c: Container) {
  return {
    getMe: handler(async (req, res) => ok(res, await c.account.me(currentUser(req)))),
    updateMe: handler(async (req, res) => {
      const user = currentUser(req);
      const input = updateMeSchema.parse(req.body);
      const me = await c.account.update(user, input);
      c.library.invalidate(user.uid);
      ok(res, me);
    }),
    deleteMe: handler(async (req, res) => {
      const user = currentUser(req);
      await c.account.delete(user);
      c.library.invalidate(user.uid);
      res.status(204).end();
    }),
  };
}
