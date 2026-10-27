/**
 * Links a Steam account to a Firebase user via Steam OpenID.
 *
 * Anti-hijacking: the linking session (state) is created by an authenticated
 * request and bound to the initiating browser with an HttpOnly cookie. A
 * callback is accepted only if the cookie matches the state in return_to, the
 * session is unused and unexpired, the OpenID nonce has never been seen and
 * Steam confirms the signature.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { randomToken, safeEqual, sha256 } from '../lib/crypto';
import { errors } from '../lib/errors';
import { logger } from '../lib/logger';
import type { Refs } from '../repositories/refs';
import type { SteamDataRepository } from '../repositories/steamDataRepository';
import type { FetchLike } from '../lib/http';
import {
  NONCE_MAX_AGE_MS, buildLoginUrl, checkAssertion, extractOpenIdParams, verifyWithSteam, type OpenIdFailure,
} from './openIdService';

export const LINK_SESSION_TTL_MS = 10 * 60 * 1000;

export type LinkFailure =
  | OpenIdFailure
  | 'invalid_state'
  | 'session_expired'
  | 'replay'
  | 'already_linked'
  | 'account_has_other_steam';

export type LinkResult = { ok: true; uid: string; steamId: string } | { ok: false; reason: LinkFailure };

export class SteamLinkService {
  private readonly db: Firestore;

  constructor(
    private readonly refs: Refs,
    private readonly data: SteamDataRepository,
    private readonly opts: { publicApiUrl: string; fetchImpl?: FetchLike },
  ) {
    this.db = refs.db;
  }

  callbackUrl(state: string) {
    return `${this.opts.publicApiUrl}/api/steam/callback?state=${encodeURIComponent(state)}`;
  }

  async start(uid: string): Promise<{ state: string; redirectUrl: string; expiresAt: Date }> {
    const user = await this.refs.user(uid).get();
    if (user.data()?.steamId) throw errors.steamAlreadyLinked('Unlink your current Steam account first');
    const state = randomToken(32);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LINK_SESSION_TTL_MS);
    await this.refs.linkSession(sha256(state)).create({ uid, createdAt: now, expiresAt, used: false });
    return { state, expiresAt, redirectUrl: buildLoginUrl(this.callbackUrl(state), this.opts.publicApiUrl) };
  }

  async complete(query: Record<string, unknown>, cookieState: string | undefined, now = new Date()): Promise<LinkResult> {
    const state = typeof query.state === 'string' ? query.state : '';
    if (!state || !cookieState || !safeEqual(state, cookieState)) return { ok: false, reason: 'invalid_state' };

    const params = extractOpenIdParams(query);
    if (!params) return { ok: false, reason: 'invalid_response' };

    const check = checkAssertion(params, this.callbackUrl(state), now.getTime());
    if (!check.ok) {
      if (check.reason === 'cancelled') await this.refs.linkSession(sha256(state)).delete().catch(() => undefined);
      return check;
    }

    const verified = await verifyWithSteam(params, this.opts.fetchImpl);
    if (verified === 'unavailable') return { ok: false, reason: 'steam_unavailable' };
    if (verified === 'invalid') return { ok: false, reason: 'verification_failed' };

    const { steamId, nonce } = check;
    const result = await this.db.runTransaction<LinkResult>(async (tx) => {
      const sessionRef = this.refs.linkSession(sha256(state));
      const nonceRef = this.refs.nonce(sha256(nonce));
      const linkRef = this.refs.steamLink(steamId);
      const [sessionSnap, nonceSnap, linkSnap] = await Promise.all([tx.get(sessionRef), tx.get(nonceRef), tx.get(linkRef)]);

      const session = sessionSnap.data();
      if (!session) return { ok: false, reason: 'invalid_state' };
      if (session.used) return { ok: false, reason: 'replay' };
      if (session.expiresAt.getTime() < now.getTime()) return { ok: false, reason: 'session_expired' };
      if (nonceSnap.exists) return { ok: false, reason: 'replay' };

      const userRef = this.refs.user(session.uid);
      const userSnap = await tx.get(userRef);
      const user = userSnap.data();
      if (!user) return { ok: false, reason: 'invalid_state' };

      // Consume the session and nonce regardless of the outcome below.
      tx.update(sessionRef, { used: true });
      tx.set(nonceRef, { steamId, expiresAt: new Date(now.getTime() + 2 * NONCE_MAX_AGE_MS) });

      const existing = linkSnap.data();
      if (existing && existing.uid !== session.uid) return { ok: false, reason: 'already_linked' };
      if (user.steamId && user.steamId !== steamId) return { ok: false, reason: 'account_has_other_steam' };

      tx.set(linkRef, { steamId, uid: session.uid, linkedAt: existing?.linkedAt ?? now });
      tx.update(userRef, { steamId, steamLinkedAt: user.steamLinkedAt ?? now, dataVersion: (user.dataVersion ?? 0) + 1 });
      return { ok: true, uid: session.uid, steamId };
    });
    logger.info('steam link attempt', { ok: result.ok, reason: result.ok ? undefined : result.reason, uid: result.ok ? result.uid : undefined });
    return result;
  }

  async unlink(uid: string): Promise<void> {
    const steamId = await this.db.runTransaction(async (tx) => {
      const userRef = this.refs.user(uid);
      const user = (await tx.get(userRef)).data();
      if (!user?.steamId) throw errors.steamNotLinked();
      if (user.activeSyncJobId && user.syncLockExpiresAt && user.syncLockExpiresAt.getTime() > Date.now()) {
        throw errors.syncInProgress(user.activeSyncJobId);
      }
      const linkRef = this.refs.steamLink(user.steamId);
      const link = (await tx.get(linkRef)).data();
      if (link && link.uid === uid) tx.delete(linkRef);
      tx.update(userRef, {
        steamId: null,
        steamLinkedAt: null,
        lastSuccessfulSyncAt: null,
        dataVersion: (user.dataVersion ?? 0) + 1,
      });
      return user.steamId;
    });
    await this.data.deleteAll(uid);
    logger.info('steam unlinked', { uid, hadSteam: Boolean(steamId) });
  }
}
