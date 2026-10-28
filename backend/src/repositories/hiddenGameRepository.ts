import { FieldValue } from 'firebase-admin/firestore';
import type { GameVisibilityInput, HiddenGameDoc } from '@steam-analytics/shared';
import { errors } from '../lib/errors';
import type { Refs } from './refs';

export class HiddenGameRepository {
  constructor(private readonly refs: Refs) {}

  async list(uid: string): Promise<HiddenGameDoc[]> {
    const snapshot = await this.refs.hiddenGames(uid).get();
    return snapshot.docs.map((doc) => doc.data());
  }

  /** Atomically save the choice and invalidate cached library data on every instance. */
  async set(uid: string, appId: number, input: GameVisibilityInput): Promise<void> {
    await this.refs.db.runTransaction(async (tx) => {
      const userRef = this.refs.user(uid);
      const [user, game] = await Promise.all([tx.get(userRef), tx.get(this.refs.game(uid, appId))]);
      if (!user.data()?.steamId) throw errors.steamNotLinked();
      if (!game.exists) throw errors.notFound('Game not found in your library');
      const ref = this.refs.hiddenGame(uid, appId);
      if (input.hidden) tx.set(ref, { appId, excludeFromStats: input.excludeFromStats });
      else tx.delete(ref);
      tx.update(userRef, { dataVersion: FieldValue.increment(1) });
    });
  }
}
