import type { CookieOptions } from 'express';
import { appIdSchema, gameListQuerySchema, gameVisibilitySchema, syncRequestSchema } from '@steam-analytics/shared';
import type { Container } from '../container';
import { handler } from '../middleware/asyncHandler';
import { currentUser } from '../middleware/auth';
import { errors } from '../lib/errors';
import { toIso } from '../lib/firestore';
import { logger } from '../lib/logger';
import { ok } from '../lib/respond';
import { LINK_SESSION_TTL_MS } from '../services/steamLinkService';
import { toJobDto } from '../services/syncService';

export function linkCookie(publicApiUrl: string) {
  const secure = publicApiUrl.startsWith('https://');
  const name = secure ? '__Host-steam_link' : 'steam_link';
  const options: CookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: LINK_SESSION_TTL_MS };
  return { name, options };
}

export function steamController(c: Container) {
  const cookie = linkCookie(c.env.PUBLIC_API_URL);
  const appRedirect = (params: Record<string, string>) => `${c.env.PUBLIC_APP_URL}/link-steam?${new URLSearchParams(params)}`;

  return {
    startAuth: handler(async (req, res) => {
      const { state, redirectUrl } = await c.links.start(currentUser(req).uid);
      res.cookie(cookie.name, state, cookie.options);
      ok(res, { redirectUrl });
    }),

    callback: handler(async (req, res) => {
      const cookieState: string | undefined = req.cookies?.[cookie.name];
      res.clearCookie(cookie.name, { ...cookie.options, maxAge: undefined });
      res.setHeader('Cache-Control', 'no-store');
      const result = await c.links.complete(req.query as Record<string, unknown>, cookieState).catch((err) => {
        logger.error('steam callback failed', { error: err });
        return { ok: false as const, reason: 'steam_unavailable' as const };
      });
      if (!result.ok) return res.redirect(303, appRedirect({ status: 'error', reason: result.reason }));
      c.library.invalidate(result.uid);
      // Acquire the job lock before redirecting so the UI immediately sees the running sync.
      await c.sync.start(result.uid, 'full', 'link').catch((err) => logger.warn('initial sync not started', { error: err }));
      res.redirect(303, appRedirect({ status: 'success' }));
    }),

    unlink: handler(async (req, res) => {
      const { uid } = currentUser(req);
      await c.links.unlink(uid);
      c.library.invalidate(uid);
      res.status(204).end();
    }),

    profile: handler(async (req, res) => {
      const { dto, source } = await c.profiles.getProfile(currentUser(req).uid);
      ok(res, dto, { source, dataAsOf: dto.summaryFetchedAt });
    }),

    games: handler(async (req, res) => {
      const q = gameListQuerySchema.parse(req.query);
      const { items, total, lib } = await c.library.list(currentUser(req).uid, q);
      ok(res, items, { source: 'cache', dataAsOf: toIso(lib.user.lastSuccessfulSyncAt), page: q.page, pageSize: q.pageSize, total });
    }),

    game: handler(async (req, res) => {
      const appId = appIdSchema.parse(req.params.appid);
      const uid = currentUser(req).uid;
      const dto = await c.library.detail(uid, appId);
      ok(res, dto, { source: 'cache' });
    }),

    visibility: handler(async (req, res) => {
      const appId = appIdSchema.parse(req.params.appid);
      const input = gameVisibilitySchema.parse(req.body);
      const { uid } = currentUser(req);
      await c.hiddenGames.set(uid, appId, input);
      c.library.invalidate(uid);
      ok(res, await c.library.detail(uid, appId));
    }),

    achievements: handler(async (req, res) => {
      const appId = appIdSchema.parse(req.params.appid);
      const uid = currentUser(req).uid;
      const user = await c.library.requireLinkedUser(uid);
      const game = await c.steamData.getGame(uid, appId);
      if (!game) throw errors.notFound('Game not found in your library');
      const dto = await c.achievements.getGameAchievements(uid, user.steamId, game, user.preferences.language);
      c.library.invalidate(uid);
      ok(res, dto, { source: 'cache', dataAsOf: dto.syncedAt });
    }),

    startSync: handler(async (req, res) => {
      const { scope } = syncRequestSchema.parse(req.body ?? {});
      const job = await c.sync.start(currentUser(req).uid, scope, 'manual');
      ok(res, toJobDto(job), undefined, 202);
    }),

    syncStatus: handler(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      ok(res, await c.sync.status(currentUser(req).uid));
    }),
  };
}
