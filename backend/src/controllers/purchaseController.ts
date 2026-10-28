import {
  appIdSchema, bundleInputSchema, importCommitSchema, purchaseInputSchema, IMPORT_MAX_BYTES,
} from '@steam-analytics/shared';
import { z } from 'zod';
import type { Container } from '../container';
import { handler } from '../middleware/asyncHandler';
import { currentUser } from '../middleware/auth';
import { errors } from '../lib/errors';
import { ok } from '../lib/respond';

import { toPurchaseDto } from '../services/purchaseService';
import { sniffImageType } from '../services/importService';

const bundleIdSchema = z.string().regex(/^b_[A-Za-z0-9_-]{8,40}$/);

export function purchaseController(c: Container) {
  return {
    list: handler(async (req, res) => {
      const { uid } = currentUser(req);
      await c.library.requireLinkedUser(uid);
      ok(res, await c.purchaseService.list(uid));
    }),
    upsert: handler(async (req, res) => {
      const { uid } = currentUser(req);
      const appId = appIdSchema.parse(req.params.appid);
      const input = purchaseInputSchema.parse(req.body);
      await c.library.requireLinkedUser(uid);
      const game = await c.steamData.getGame(uid, appId);
      if (!game) throw errors.notFound('Game not found in your library');
      const doc = await c.purchases.upsert(uid, appId, input);
      await c.users.bumpDataVersion(uid);
      c.library.invalidate(uid);
      ok(res, toPurchaseDto(doc, game.name));
    }),
    getBundle: handler(async (req, res) => {
      const { uid } = currentUser(req);
      ok(res, await c.purchaseService.getBundle(uid, bundleIdSchema.parse(req.params.id)));
    }),
    createBundle: handler(async (req, res) => {
      const { uid } = currentUser(req);
      const input = bundleInputSchema.parse(req.body);
      await c.library.requireLinkedUser(uid);
      ok(res, await c.purchaseService.createBundle(uid, input), undefined, 201);
    }),
    updateBundle: handler(async (req, res) => {
      const { uid } = currentUser(req);
      const id = bundleIdSchema.parse(req.params.id);
      const input = bundleInputSchema.parse(req.body);
      await c.library.requireLinkedUser(uid);
      ok(res, await c.purchaseService.updateBundle(uid, id, input));
    }),
    deleteBundle: handler(async (req, res) => {
      const { uid } = currentUser(req);
      await c.purchaseService.deleteBundle(uid, bundleIdSchema.parse(req.params.id));
      res.status(204).end();
    }),
    importStatus: handler(async (_req, res) => {
      ok(res, { available: c.imports.available, maxBytes: IMPORT_MAX_BYTES });
    }),
    importPreview: handler(async (req, res) => {
      const { uid } = currentUser(req);
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw errors.importFailed('Upload a PNG, JPEG, WebP or GIF image');
      const mediaType = sniffImageType(body);
      if (!mediaType) throw errors.importFailed('Upload a PNG, JPEG, WebP or GIF image');
      await c.library.requireLinkedUser(uid);
      ok(res, await c.imports.preview(uid, body, mediaType));
    }),
    importCommit: handler(async (req, res) => {
      const { uid } = currentUser(req);
      const input = importCommitSchema.parse(req.body);
      await c.library.requireLinkedUser(uid);
      ok(res, await c.purchaseService.commitImport(uid, input), undefined, 201);
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
