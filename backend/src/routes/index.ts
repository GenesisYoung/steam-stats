import { Router } from 'express';
import type { Container } from '../container';
import { accountController } from '../controllers/accountController';
import { analyticsController } from '../controllers/analyticsController';
import { internalController } from '../controllers/internalController';
import { purchaseController } from '../controllers/purchaseController';
import { steamController } from '../controllers/steamController';
import { authenticate, requireVerifiedEmail } from '../middleware/auth';
import { limiter } from '../middleware/security';

const MIN = 60 * 1000;

export function apiRouter(c: Container): Router {
  const router = Router();
  const auth = authenticate(c.auth);
  const account = accountController(c);
  const steam = steamController(c);
  const analytics = analyticsController(c);
  const purchases = purchaseController(c);

  router.get('/health', (_req, res) => res.json({ data: { status: 'ok' } }));

  // Public: Steam redirects the browser here (validated via state cookie + OpenID signature).
  router.get('/steam/callback', limiter({ windowMs: 15 * MIN, limit: 30 }), steam.callback);

  router.use(auth);
  const perUser = limiter({ windowMs: MIN, limit: 120, perUser: true });
  router.use(perUser);

  router.get('/me', account.getMe);
  router.patch('/me', account.updateMe);
  router.delete('/me', limiter({ windowMs: 15 * MIN, limit: 5, perUser: true }), account.deleteMe);

  router.post('/steam/auth', limiter({ windowMs: 15 * MIN, limit: 10, perUser: true }), requireVerifiedEmail(c.env.REQUIRE_EMAIL_VERIFIED), steam.startAuth);
  router.delete('/steam/link', steam.unlink);
  router.get('/steam/profile', steam.profile);
  router.get('/steam/games', steam.games);
  router.get('/steam/games/:appid', steam.game);
  router.get('/steam/games/:appid/achievements', limiter({ windowMs: MIN, limit: 30, perUser: true }), steam.achievements);
  router.post('/steam/sync', limiter({ windowMs: 15 * MIN, limit: 20, perUser: true }), steam.startSync);
  router.get('/steam/sync/status', steam.syncStatus);

  router.get('/analytics/overview', analytics.overview);
  router.get('/analytics/playtime', analytics.playtime);
  router.get('/analytics/achievements', analytics.achievements);
  router.get('/analytics/library-value', analytics.libraryValue);
  router.get('/analytics/cost-efficiency', analytics.costEfficiency);

  router.get('/purchases', purchases.list);
  router.put('/purchases/:appid', purchases.upsert);
  router.delete('/purchases/:appid', purchases.remove);

  return router;
}

export function internalRouter(c: Container): Router {
  const router = Router();
  const internal = internalController(c);
  router.post('/cron/sync', limiter({ windowMs: MIN, limit: 5 }), internal.cronSync);
  return router;
}
