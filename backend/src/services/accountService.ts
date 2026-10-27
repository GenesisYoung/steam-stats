import type { Auth } from 'firebase-admin/auth';
import type { MeDto, UpdateMeInput, UserDoc } from '@steam-analytics/shared';
import { errors } from '../lib/errors';
import { toIso } from '../lib/firestore';
import { logger } from '../lib/logger';
import type { Refs } from '../repositories/refs';
import type { UserRepository } from '../repositories/userRepository';
import type { AuthUser } from '../types/auth';

/** Account deletion requires a sign-in within this window. */
export const RECENT_AUTH_MS = 5 * 60 * 1000;

export const toMeDto = (doc: UserDoc, emailVerified: boolean): MeDto => ({
  uid: doc.uid,
  email: doc.email,
  emailVerified,
  displayName: doc.displayName,
  createdAt: doc.createdAt.toISOString(),
  lastLoginAt: doc.lastLoginAt.toISOString(),
  steamId: doc.steamId,
  steamLinkedAt: toIso(doc.steamLinkedAt),
  preferences: doc.preferences,
  lastSuccessfulSyncAt: toIso(doc.lastSuccessfulSyncAt),
});

export class AccountService {
  constructor(
    private readonly refs: Refs,
    private readonly users: UserRepository,
    private readonly auth: Auth,
  ) {}

  async me(user: AuthUser): Promise<MeDto> {
    const doc = await this.users.ensure(user.uid, user.email, user.name);
    return toMeDto(doc, user.emailVerified);
  }

  async update(user: AuthUser, input: UpdateMeInput): Promise<MeDto> {
    await this.users.ensure(user.uid, user.email, user.name);
    await this.users.update(user.uid, input);
    if (input.displayName) await this.auth.updateUser(user.uid, { displayName: input.displayName }).catch(() => undefined);
    const doc = await this.users.get(user.uid);
    return toMeDto(doc!, user.emailVerified);
  }

  /**
   * Deletes all user data, the SteamID mapping and the Firebase Auth user.
   * Requires a recent sign-in (auth_time) to protect against stolen sessions.
   */
  async delete(user: AuthUser, now = Date.now()): Promise<void> {
    if (now - user.authTime * 1000 > RECENT_AUTH_MS) throw errors.recentLoginRequired();
    const db = this.refs.db;
    await db.runTransaction(async (tx) => {
      const userRef = this.refs.user(user.uid);
      const doc = (await tx.get(userRef)).data();
      if (doc?.activeSyncJobId && doc.syncLockExpiresAt && doc.syncLockExpiresAt.getTime() > now) {
        throw errors.syncInProgress(doc.activeSyncJobId);
      }
      if (doc?.steamId) {
        const linkRef = this.refs.steamLink(doc.steamId);
        const link = (await tx.get(linkRef)).data();
        if (link?.uid === user.uid) tx.delete(linkRef);
      }
    });
    await db.recursiveDelete(this.refs.user(user.uid));
    await this.auth.deleteUser(user.uid);
    logger.info('account deleted', { uid: user.uid });
  }
}
