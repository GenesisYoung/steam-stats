import type { PurchaseDoc, PurchaseInput } from '@steam-analytics/shared';
import { errors } from '../lib/errors';
import type { Refs } from './refs';

export class PurchaseRepository {
  constructor(private readonly refs: Refs) {}

  async list(uid: string): Promise<PurchaseDoc[]> {
    const snap = await this.refs.purchases(uid).get();
    return snap.docs.map((d) => d.data());
  }

  async get(uid: string, appId: number): Promise<PurchaseDoc | null> {
    const snap = await this.refs.purchase(uid, appId).get();
    return snap.exists ? snap.data()! : null;
  }

  async listBundle(uid: string, bundleId: string): Promise<PurchaseDoc[]> {
    const snap = await this.refs.purchases(uid).where('bundle.id', '==', bundleId).get();
    return snap.docs.map((d) => d.data());
  }

  /** Single-game record. Games that belong to a bundle must be edited through the bundle. */
  async upsert(uid: string, appId: number, input: PurchaseInput): Promise<PurchaseDoc> {
    return this.refs.db.runTransaction(async (tx) => {
      const ref = this.refs.purchase(uid, appId);
      const existing = (await tx.get(ref)).data();
      if (existing?.bundle) throw errors.purchaseConflict('This game is part of a bundle; edit the bundle instead', [appId]);
      const now = new Date();
      const doc: PurchaseDoc = { appId, ...input, bundle: null, origin: existing?.origin ?? 'manual', createdAt: existing?.createdAt ?? now, updatedAt: now };
      tx.set(ref, doc);
      return doc;
    });
  }

  async delete(uid: string, appId: number): Promise<boolean> {
    return this.refs.db.runTransaction(async (tx) => {
      const ref = this.refs.purchase(uid, appId);
      const existing = (await tx.get(ref)).data();
      if (!existing) return false;
      if (existing.bundle) throw errors.purchaseConflict('This game is part of a bundle; delete the bundle instead', [appId]);
      tx.delete(ref);
      return true;
    });
  }

  /**
   * Write a set of purchase records atomically. Existing records for the same
   * games are a conflict unless they belong to `ownBundleId` (when updating a
   * bundle) or `replaceExisting` is set for single-game records. Records of
   * `ownBundleId` that are no longer included are removed.
   */
  async writeRecords(
    uid: string,
    docs: PurchaseDoc[],
    opts: { replaceExisting: boolean; ownBundleId?: string },
  ): Promise<void> {
    await this.refs.db.runTransaction(async (tx) => {
      const refs = docs.map((d) => this.refs.purchase(uid, d.appId));
      const [existing, previousBundle] = await Promise.all([
        refs.length ? tx.getAll(...refs) : Promise.resolve([]),
        opts.ownBundleId ? tx.get(this.refs.purchases(uid).where('bundle.id', '==', opts.ownBundleId)) : Promise.resolve(null),
      ]);
      const conflicts = existing.flatMap((snap) => {
        const d = snap.data();
        if (!d) return [];
        if (d.bundle && d.bundle.id === opts.ownBundleId) return [];
        if (!d.bundle && opts.replaceExisting) return [];
        return [d.appId];
      });
      if (conflicts.length) throw errors.purchaseConflict('Some games already have a purchase record', conflicts);

      const keep = new Set(docs.map((d) => d.appId));
      previousBundle?.docs.forEach((snap) => {
        if (!keep.has(snap.data().appId)) tx.delete(snap.ref);
      });
      existing.forEach((snap, i) => tx.set(refs[i]!, { ...docs[i]!, createdAt: snap.data()?.createdAt ?? docs[i]!.createdAt }));
    });
  }

  async deleteBundle(uid: string, bundleId: string): Promise<number> {
    return this.refs.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.refs.purchases(uid).where('bundle.id', '==', bundleId));
      snap.docs.forEach((d) => tx.delete(d.ref));
      return snap.size;
    });
  }
}
