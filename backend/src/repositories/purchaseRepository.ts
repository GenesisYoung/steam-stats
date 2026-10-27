import type { PurchaseDoc, PurchaseInput } from '@steam-analytics/shared';
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

  async upsert(uid: string, appId: number, input: PurchaseInput): Promise<PurchaseDoc> {
    return this.refs.db.runTransaction(async (tx) => {
      const ref = this.refs.purchase(uid, appId);
      const existing = await tx.get(ref);
      const now = new Date();
      const doc: PurchaseDoc = {
        appId,
        ...input,
        createdAt: existing.exists ? existing.data()!.createdAt : now,
        updatedAt: now,
      };
      tx.set(ref, doc);
      return doc;
    });
  }

  async delete(uid: string, appId: number): Promise<boolean> {
    const ref = this.refs.purchase(uid, appId);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.delete();
    return true;
  }
}
