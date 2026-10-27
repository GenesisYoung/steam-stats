import type { OwnedGameDoc, PlayerAchievementStateDoc, PlaytimeSnapshotDoc, SteamProfileDoc } from '@steam-analytics/shared';
import { chunk } from '../lib/async';
import type { Refs } from './refs';

/** Per-user Steam data. Only the backend writes these documents. */
export class SteamDataRepository {
  constructor(private readonly refs: Refs) {}

  async getProfile(uid: string): Promise<SteamProfileDoc | null> {
    const snap = await this.refs.steamProfile(uid).get();
    return snap.exists ? snap.data()! : null;
  }

  async setProfile(uid: string, profile: SteamProfileDoc): Promise<void> {
    await this.refs.steamProfile(uid).set(profile);
  }

  async patchProfile(uid: string, patch: Partial<SteamProfileDoc>): Promise<void> {
    await this.refs.steamProfile(uid).set(patch, { merge: true });
  }

  async listGames(uid: string): Promise<OwnedGameDoc[]> {
    const snap = await this.refs.games(uid).get();
    return snap.docs.map((d) => d.data());
  }

  async getGame(uid: string, appId: number): Promise<OwnedGameDoc | null> {
    const snap = await this.refs.game(uid, appId).get();
    return snap.exists ? snap.data()! : null;
  }

  /** Writes games in batches (max 500 operations per batch). */
  async writeGames(uid: string, games: OwnedGameDoc[]): Promise<void> {
    for (const part of chunk(games, 400)) {
      const batch = this.refs.db.batch();
      for (const g of part) batch.set(this.refs.game(uid, g.appId), g);
      await batch.commit();
    }
  }

  async patchGame(uid: string, appId: number, patch: Partial<OwnedGameDoc>): Promise<void> {
    await this.refs.game(uid, appId).set(patch, { merge: true });
  }

  async deleteGames(uid: string, appIds: number[]): Promise<void> {
    for (const appId of appIds) await this.refs.db.recursiveDelete(this.refs.game(uid, appId));
  }

  async getAchievementState(uid: string, appId: number): Promise<PlayerAchievementStateDoc | null> {
    const snap = await this.refs.achievementState(uid, appId).get();
    return snap.exists ? snap.data()! : null;
  }

  async setAchievementState(uid: string, state: PlayerAchievementStateDoc, summary: Partial<OwnedGameDoc>): Promise<void> {
    const batch = this.refs.db.batch();
    batch.set(this.refs.achievementState(uid, state.appId), state);
    batch.set(this.refs.game(uid, state.appId), summary, { merge: true });
    await batch.commit();
  }

  async setSnapshot(uid: string, snapshot: PlaytimeSnapshotDoc): Promise<void> {
    await this.refs.snapshots(uid).doc(snapshot.date).set(snapshot);
  }

  async listSnapshots(uid: string, limit = 400): Promise<PlaytimeSnapshotDoc[]> {
    const snap = await this.refs.snapshots(uid).orderBy('date', 'desc').limit(limit).get();
    return snap.docs.map((d) => d.data()).reverse();
  }

  /** Removes all trusted Steam data for a user (used on unlink). Purchases are kept. */
  async deleteAll(uid: string): Promise<void> {
    const db = this.refs.db;
    await Promise.all([
      db.recursiveDelete(db.collection(`users/${uid}/games`)),
      db.recursiveDelete(db.collection(`users/${uid}/playtimeSnapshots`)),
      db.recursiveDelete(db.collection(`users/${uid}/syncJobs`)),
      db.recursiveDelete(db.collection(`users/${uid}/steamProfile`)),
    ]);
  }
}
