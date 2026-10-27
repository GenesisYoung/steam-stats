import { FieldValue } from 'firebase-admin/firestore';
import type { UserDoc, UserPreferences } from '@steam-analytics/shared';
import type { Refs } from './refs';

export const DEFAULT_PREFERENCES: UserPreferences = {
  currency: 'USD',
  language: 'en',
  storeRegion: 'us',
  theme: 'dark',
  autoSync: true,
};

const LAST_LOGIN_THROTTLE_MS = 10 * 60 * 1000;

export class UserRepository {
  constructor(private readonly refs: Refs) {}

  async get(uid: string): Promise<UserDoc | null> {
    const snap = await this.refs.user(uid).get();
    return snap.exists ? snap.data()! : null;
  }

  /** Creates the profile document on first use and records the login time (throttled). */
  async ensure(uid: string, email: string, displayName: string | undefined, preferredLanguage?: UserPreferences['language']): Promise<UserDoc> {
    return this.refs.db.runTransaction(async (tx) => {
      const ref = this.refs.user(uid);
      const snap = await tx.get(ref);
      const now = new Date();
      if (!snap.exists) {
        const doc: UserDoc = {
          uid,
          email,
          displayName: displayName?.trim() || email.split('@')[0] || 'Player',
          createdAt: now,
          lastLoginAt: now,
          steamId: null,
          steamLinkedAt: null,
          preferences: { ...DEFAULT_PREFERENCES, ...(preferredLanguage ? { language: preferredLanguage } : {}) },
          dataVersion: 0,
          lastSuccessfulSyncAt: null,
          activeSyncJobId: null,
          syncLockExpiresAt: null,
        };
        tx.set(ref, doc);
        return doc;
      }
      const doc = snap.data()!;
      const updates: Partial<UserDoc> = {};
      if (now.getTime() - doc.lastLoginAt.getTime() > LAST_LOGIN_THROTTLE_MS) updates.lastLoginAt = now;
      if (doc.email !== email) updates.email = email;
      if (Object.keys(updates).length > 0) tx.update(ref, updates);
      return { ...doc, ...updates };
    });
  }

  async update(uid: string, input: { displayName?: string; preferences?: Partial<UserPreferences> }): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (input.displayName !== undefined) updates.displayName = input.displayName;
    for (const [k, v] of Object.entries(input.preferences ?? {})) updates[`preferences.${k}`] = v;
    if (input.preferences?.storeRegion) updates.dataVersion = FieldValue.increment(1);
    await this.refs.user(uid).update(updates);
  }

  async bumpDataVersion(uid: string): Promise<void> {
    await this.refs.user(uid).update({ dataVersion: FieldValue.increment(1) });
  }

  /** Linked users with auto-sync enabled whose last successful sync is older than `before`. */
  async findAutoSyncCandidates(before: Date, limit: number): Promise<UserDoc[]> {
    const base = this.refs.users.where('preferences.autoSync', '==', true);
    const [never, stale] = await Promise.all([
      base.where('lastSuccessfulSyncAt', '==', null).limit(limit).get(),
      base.where('lastSuccessfulSyncAt', '<', before).orderBy('lastSuccessfulSyncAt', 'asc').limit(limit).get(),
    ]);
    return [...never.docs, ...stale.docs]
      .map((d) => d.data())
      .filter((u) => u.steamId !== null)
      .slice(0, limit);
  }
}
