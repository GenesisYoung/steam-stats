import {
  allocateBundle,
  type BundleDto, type BundleInput, type ImportCommitInput, type ImportCommitResultDto, type PurchaseDoc,
  type PurchaseDto, type PurchaseOrigin,
} from '@steam-analytics/shared';
import { randomToken } from '../lib/crypto';
import { errors } from '../lib/errors';
import type { PurchaseRepository } from '../repositories/purchaseRepository';
import type { UserRepository } from '../repositories/userRepository';
import type { LibraryService } from './libraryService';

export const toPurchaseDto = (p: PurchaseDoc, gameName: string | null = null): PurchaseDto => ({
  ...p,
  gameName,
  bundle: p.bundle ?? null,
  origin: p.origin ?? 'manual',
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
  userEntered: true,
});

type BundleRequest = Omit<BundleInput, 'replaceExisting'> & { replaceExisting: boolean };

/** User-recorded purchases: single games and bundles (several games, one price). */
export class PurchaseService {
  constructor(
    private readonly purchases: PurchaseRepository,
    private readonly library: LibraryService,
    private readonly users: UserRepository,
  ) {}

  private async changed(uid: string) {
    await this.users.bumpDataVersion(uid);
    this.library.invalidate(uid);
  }

  /** Owned games by appId; throws if any requested game is not in the library. */
  private async ownedGames(uid: string, appIds: number[]) {
    const lib = await this.library.load(uid);
    const byId = new Map(lib.entries.map((e) => [e.game.appId, e]));
    const missing = appIds.filter((id) => !byId.has(id));
    if (missing.length) throw errors.notFound(`Not in your library: ${missing.join(', ')}`);
    return byId;
  }

  /** Build the per-game records for one bundle, splitting the total as requested. */
  private async bundleDocs(uid: string, input: BundleRequest, bundleId: string, origin: PurchaseOrigin): Promise<PurchaseDoc[]> {
    const owned = await this.ownedGames(uid, input.appIds);
    let amounts: number[];
    let allocation = input.allocation;
    if (input.allocation === 'manual') {
      const shares = new Map(input.shares!.map((s) => [s.appId, s.amount]));
      amounts = input.appIds.map((id) => shares.get(id)!);
    } else {
      const weights = input.allocation === 'even' ? input.appIds.map(() => 1) : input.appIds.map((id) => owned.get(id)!.price.amount);
      const result = allocateBundle(input.total, weights);
      amounts = result.amounts;
      if (input.allocation === 'store_price' && result.method === 'even') allocation = 'even';
    }
    const now = new Date();
    return input.appIds.map((appId, i) => ({
      appId,
      amount: amounts[i]!,
      currency: input.currency,
      purchaseDate: input.purchaseDate,
      source: input.source,
      notes: input.notes,
      bundle: { id: bundleId, total: input.total, itemCount: input.appIds.length, allocation },
      origin,
      createdAt: now,
      updatedAt: now,
    }));
  }

  async list(uid: string): Promise<PurchaseDto[]> {
    const [records, lib] = await Promise.all([this.purchases.list(uid), this.library.load(uid)]);
    const names = new Map(lib.entries.map((e) => [e.game.appId, e.game.name]));
    return records
      .map((p) => toPurchaseDto(p, names.get(p.appId) ?? null))
      .sort((a, b) => (b.purchaseDate ?? '').localeCompare(a.purchaseDate ?? '') || b.updatedAt.localeCompare(a.updatedAt));
  }

  async getBundle(uid: string, bundleId: string): Promise<BundleDto> {
    const docs = await this.purchases.listBundle(uid, bundleId);
    const first = docs[0];
    if (!first?.bundle) throw errors.notFound('Bundle not found');
    const lib = await this.library.load(uid);
    const names = new Map(lib.entries.map((e) => [e.game.appId, e.game.name]));
    return {
      id: bundleId,
      total: first.bundle.total,
      currency: first.currency,
      purchaseDate: first.purchaseDate,
      source: first.source,
      notes: first.notes,
      allocation: first.bundle.allocation,
      origin: first.origin ?? 'manual',
      items: docs
        .map((d) => ({ appId: d.appId, name: names.get(d.appId) ?? `App ${d.appId}`, amount: d.amount }))
        .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
    };
  }

  async createBundle(uid: string, input: BundleInput): Promise<BundleDto> {
    const bundleId = `b_${randomToken(12)}`;
    const docs = await this.bundleDocs(uid, input, bundleId, 'manual');
    await this.purchases.writeRecords(uid, docs, { replaceExisting: input.replaceExisting });
    await this.changed(uid);
    return this.getBundle(uid, bundleId);
  }

  async updateBundle(uid: string, bundleId: string, input: BundleInput): Promise<BundleDto> {
    const existing = await this.purchases.listBundle(uid, bundleId);
    if (!existing.length) throw errors.notFound('Bundle not found');
    const docs = await this.bundleDocs(uid, input, bundleId, existing[0]!.origin ?? 'manual');
    await this.purchases.writeRecords(uid, docs, { replaceExisting: input.replaceExisting, ownBundleId: bundleId });
    await this.changed(uid);
    return this.getBundle(uid, bundleId);
  }

  async deleteBundle(uid: string, bundleId: string): Promise<void> {
    if ((await this.purchases.deleteBundle(uid, bundleId)) === 0) throw errors.notFound('Bundle not found');
    await this.changed(uid);
  }

  /** Save reviewed screenshot transactions: one game = single record, several = bundle. */
  async commitImport(uid: string, input: ImportCommitInput): Promise<ImportCommitResultDto> {
    const allIds = input.transactions.flatMap((t) => t.appIds);
    if (new Set(allIds).size !== allIds.length) throw errors.purchaseConflict('A game appears in more than one transaction', []);
    await this.ownedGames(uid, allIds);

    const existing = new Map((await this.purchases.list(uid)).map((p) => [p.appId, p]));
    const docs: PurchaseDoc[] = [];
    let created = 0;
    let bundlesCreated = 0;
    let skipped = 0;
    for (const t of input.transactions) {
      const appIds = t.appIds.filter((id) => {
        const prev = existing.get(id);
        const keep = !prev || (input.replaceExisting && !prev.bundle);
        if (!keep) skipped += 1;
        return keep;
      });
      if (appIds.length === 0) continue;
      const now = new Date();
      if (appIds.length === 1) {
        docs.push({ appId: appIds[0]!, amount: t.total, currency: t.currency, purchaseDate: t.purchaseDate, source: t.source, notes: t.notes, bundle: null, origin: 'screenshot_import', createdAt: now, updatedAt: now });
      } else {
        docs.push(...(await this.bundleDocs(uid, { ...t, appIds, allocation: 'store_price', replaceExisting: input.replaceExisting }, `b_${randomToken(12)}`, 'screenshot_import')));
        bundlesCreated += 1;
      }
      created += appIds.length;
    }
    if (docs.length) {
      await this.purchases.writeRecords(uid, docs, { replaceExisting: input.replaceExisting });
      await this.changed(uid);
    }
    return { created, bundlesCreated, skipped };
  }
}
