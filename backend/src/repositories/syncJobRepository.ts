import type { SyncJobDoc } from '@steam-analytics/shared';
import type { Refs } from './refs';

export class SyncJobRepository {
  constructor(private readonly refs: Refs) {}

  async get(uid: string, jobId: string): Promise<SyncJobDoc | null> {
    const snap = await this.refs.syncJobs(uid).doc(jobId).get();
    return snap.exists ? snap.data()! : null;
  }

  async latest(uid: string): Promise<SyncJobDoc | null> {
    const snap = await this.refs.syncJobs(uid).orderBy('startedAt', 'desc').limit(1).get();
    return snap.docs[0]?.data() ?? null;
  }

  async update(uid: string, jobId: string, patch: Partial<SyncJobDoc>): Promise<void> {
    await this.refs.syncJobs(uid).doc(jobId).set(patch, { merge: true });
  }

  /** Keep only the most recent jobs to bound storage. */
  async prune(uid: string, keep = 20): Promise<void> {
    const snap = await this.refs.syncJobs(uid).orderBy('startedAt', 'desc').offset(keep).limit(100).get();
    if (snap.empty) return;
    const batch = this.refs.db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}
