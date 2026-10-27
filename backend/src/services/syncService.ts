/**
 * Steam data synchronization.
 *
 * - One job per user at a time: a lock (activeSyncJobId + syncLockExpiresAt)
 *   is acquired in a Firestore transaction; stale locks expire automatically.
 * - "profile" scope: player summary + level only (cheap).
 * - "full" scope: profile, owned games (only changed docs are written),
 *   daily playtime snapshot, batched achievements and prices. Work beyond the
 *   per-job budget is reported as "remaining" and continues on the next sync.
 */
import type { OwnedGameDoc, SyncJobDoc, SyncScope, SyncStatusDto, SyncTrigger, SyncJobDto } from '@steam-analytics/shared';
import { mapLimit } from '../lib/async';
import { AppError, errors, UpstreamError } from '../lib/errors';
import { toIso } from '../lib/firestore';
import { logger } from '../lib/logger';
import type { Refs } from '../repositories/refs';
import type { SteamDataRepository } from '../repositories/steamDataRepository';
import type { SyncJobRepository } from '../repositories/syncJobRepository';
import type { UserRepository } from '../repositories/userRepository';
import { needsAchievementSync, type AchievementService } from './achievementService';
import type { LibraryService } from './libraryService';
import type { PricingService } from './pricingService';
import type { SteamApiClient, SteamOwnedGame } from './steamApiClient';
import type { SteamProfileService } from './steamProfileService';

export const LOCK_TTL_MS = 15 * 60 * 1000;
/** Minimum gap between two manual full syncs. */
export const FULL_SYNC_COOLDOWN_MS = 2 * 60 * 1000;

export interface SyncOptions {
  achievementBatch: number;
  metadataBatch: number;
}

export const toJobDto = (j: SyncJobDoc): SyncJobDto => ({
  ...j,
  startedAt: j.startedAt.toISOString(),
  finishedAt: toIso(j.finishedAt),
});

/** Build the stored game doc from Steam data, preserving achievement summary. */
export function mergeOwnedGame(g: SteamOwnedGame, previous: OwnedGameDoc | undefined, now: Date): OwnedGameDoc {
  return {
    appId: g.appid,
    name: g.name?.trim() || previous?.name || `App ${g.appid}`,
    iconHash: g.img_icon_url || null,
    playtimeForeverMinutes: g.playtime_forever,
    playtime2WeeksMinutes: g.playtime_2weeks ?? 0,
    lastPlayedAt: g.rtime_last_played ? new Date(g.rtime_last_played * 1000) : null,
    hasCommunityVisibleStats: g.has_community_visible_stats ?? null,
    achievements: previous?.achievements ?? { status: 'unknown', total: null, unlocked: null, syncedAt: null, syncedAtPlaytime: null },
    updatedAt: now,
  };
}

const sameGame = (a: OwnedGameDoc, b: OwnedGameDoc) =>
  a.name === b.name &&
  a.iconHash === b.iconHash &&
  a.playtimeForeverMinutes === b.playtimeForeverMinutes &&
  a.playtime2WeeksMinutes === b.playtime2WeeksMinutes &&
  (a.lastPlayedAt?.getTime() ?? null) === (b.lastPlayedAt?.getTime() ?? null) &&
  a.hasCommunityVisibleStats === b.hasCommunityVisibleStats;

export const snapshotDate = (d: Date) => d.toISOString().slice(0, 10);

export class SyncService {
  private running = new Map<string, Promise<void>>();

  constructor(
    private readonly refs: Refs,
    private readonly users: UserRepository,
    private readonly jobs: SyncJobRepository,
    private readonly data: SteamDataRepository,
    private readonly steam: SteamApiClient,
    private readonly profiles: SteamProfileService,
    private readonly achievements: AchievementService,
    private readonly pricing: PricingService,
    private readonly library: LibraryService,
    private readonly opts: SyncOptions,
  ) {}

  /** Acquire the per-user lock and create the job document atomically. */
  async acquire(uid: string, scope: SyncScope, trigger: SyncTrigger, now = new Date()): Promise<SyncJobDoc> {
    return this.refs.db.runTransaction(async (tx) => {
      const userRef = this.refs.user(uid);
      const user = (await tx.get(userRef)).data();
      if (!user) throw errors.notFound('User profile not found');
      if (!user.steamId) throw errors.steamNotLinked();
      if (user.activeSyncJobId && user.syncLockExpiresAt && user.syncLockExpiresAt.getTime() > now.getTime()) {
        throw errors.syncInProgress(user.activeSyncJobId);
      }
      if (trigger === 'manual' && scope === 'full' && user.lastSuccessfulSyncAt) {
        const wait = FULL_SYNC_COOLDOWN_MS - (now.getTime() - user.lastSuccessfulSyncAt.getTime());
        if (wait > 0) throw errors.rateLimited('Please wait before syncing again', Math.ceil(wait / 1000));
      }
      const jobRef = this.refs.syncJobs(uid).doc();
      const job: SyncJobDoc = {
        id: jobRef.id,
        scope,
        trigger,
        status: 'running',
        stage: 'profile',
        startedAt: now,
        finishedAt: null,
        stats: { gamesTotal: 0, gamesWritten: 0, achievementsSynced: 0, achievementsRemaining: 0, pricesUpdated: 0, pricesRemaining: 0 },
        error: null,
      };
      tx.set(jobRef, job);
      tx.update(userRef, { activeSyncJobId: job.id, syncLockExpiresAt: new Date(now.getTime() + LOCK_TTL_MS) });
      return job;
    });
  }

  /** Start a job in the background. Returns immediately with the job document. */
  async start(uid: string, scope: SyncScope, trigger: SyncTrigger): Promise<SyncJobDoc> {
    const job = await this.acquire(uid, scope, trigger);
    const promise = this.run(uid, job)
      .catch((err) => logger.error('sync job crashed', { uid, jobId: job.id, error: err }))
      .finally(() => this.running.delete(uid));
    this.running.set(uid, promise);
    return job;
  }

  /** Await a user's in-process background job (tests, graceful shutdown). */
  async wait(uid?: string) {
    await Promise.all(uid ? [this.running.get(uid)] : [...this.running.values()]);
  }

  private async release(uid: string, jobId: string, patch: Record<string, unknown>) {
    await this.refs.db.runTransaction(async (tx) => {
      const ref = this.refs.user(uid);
      const user = (await tx.get(ref)).data();
      if (!user) return;
      const updates: Record<string, unknown> = { ...patch, dataVersion: (user.dataVersion ?? 0) + 1 };
      if (user.activeSyncJobId === jobId) Object.assign(updates, { activeSyncJobId: null, syncLockExpiresAt: null });
      tx.update(ref, updates);
    });
  }

  async run(uid: string, job: SyncJobDoc): Promise<void> {
    const stats = { ...job.stats };
    const update = (patch: Partial<SyncJobDoc>) => this.jobs.update(uid, job.id, { ...patch, stats });
    const heartbeat = () =>
      this.refs.user(uid).update({ syncLockExpiresAt: new Date(Date.now() + LOCK_TTL_MS) }).catch(() => undefined);
    let partial = false;

    try {
      const user = await this.users.get(uid);
      if (!user?.steamId) throw errors.steamNotLinked();
      const steamId = user.steamId;
      const lang = user.preferences.language;

      await this.profiles.refresh(uid, steamId);
      if (job.scope === 'profile') {
        await update({ status: 'succeeded', stage: 'done', finishedAt: new Date() });
        await this.release(uid, job.id, {});
        return;
      }

      // ---- Library ----
      await update({ stage: 'library' });
      const owned = await this.steam.getOwnedGames(steamId);
      await this.data.patchProfile(uid, { gameDetailsVisible: owned.visible });
      if (!owned.visible) throw errors.steamPrivate('Steam game details are private; set them to public to sync your library');
      const now = new Date();
      const existing = new Map((await this.data.listGames(uid)).map((g) => [g.appId, g]));
      const merged = owned.games.map((g) => mergeOwnedGame(g, existing.get(g.appid), now));
      const changed = merged.filter((g) => {
        const prev = existing.get(g.appId);
        return !prev || !sameGame(prev, g);
      });
      await this.data.writeGames(uid, changed);
      const ownedIds = new Set(merged.map((g) => g.appId));
      const removed = [...existing.keys()].filter((id) => !ownedIds.has(id));
      if (removed.length > 0) await this.data.deleteGames(uid, removed);
      stats.gamesTotal = merged.length;
      stats.gamesWritten = changed.length;

      // ---- Snapshot (one per UTC day; latest sync of the day wins) ----
      await update({ stage: 'snapshot' });
      const games: Record<string, number> = {};
      let totalMinutes = 0;
      for (const g of merged) {
        totalMinutes += g.playtimeForeverMinutes;
        if (g.playtimeForeverMinutes > 0) games[String(g.appId)] = g.playtimeForeverMinutes;
      }
      await this.data.setSnapshot(uid, { date: snapshotDate(now), capturedAt: now, totalMinutes, games });

      // ---- Achievements (batched, prioritised by recent / total playtime) ----
      await update({ stage: 'achievements' });
      await heartbeat();
      const pending = merged
        .filter((g) => needsAchievementSync(g))
        .sort((a, b) => b.playtime2WeeksMinutes - a.playtime2WeeksMinutes || b.playtimeForeverMinutes - a.playtimeForeverMinutes);
      const batch = pending.slice(0, this.opts.achievementBatch);
      let privateDetected = false;
      let processed = 0;
      await mapLimit(batch, 4, async (g) => {
        if (privateDetected) return;
        const outcome = await this.achievements.syncGame(uid, steamId, g, lang);
        processed += 1;
        if (outcome === 'private') privateDetected = true;
        if (outcome === 'error') partial = true;
        else stats.achievementsSynced += 1;
        if (processed % 25 === 0) await Promise.all([update({}), heartbeat()]);
      });
      stats.achievementsRemaining = pending.length - stats.achievementsSynced;
      if (stats.achievementsRemaining > 0) partial = true;

      // ---- Prices ----
      await update({ stage: 'prices' });
      await heartbeat();
      const priceResult = await this.pricing.refresh([...ownedIds], user.preferences.storeRegion, this.opts.metadataBatch);
      stats.pricesUpdated = priceResult.pricesUpdated;
      stats.pricesRemaining = priceResult.pricesRemaining;
      if (priceResult.pricesRemaining > 0) partial = true;

      const finishedAt = new Date();
      await update({ status: partial ? 'partial' : 'succeeded', stage: 'done', finishedAt });
      await this.release(uid, job.id, { lastSuccessfulSyncAt: finishedAt });
      this.library.invalidate(uid);
      await this.jobs.prune(uid).catch(() => undefined);
    } catch (err) {
      const appErr =
        err instanceof AppError
          ? err
          : err instanceof UpstreamError
            ? errors.steamUnavailable(err.message)
            : new AppError(500, 'INTERNAL', 'Synchronization failed');
      if (!(err instanceof AppError) && !(err instanceof UpstreamError)) logger.error('sync failed', { uid, jobId: job.id, error: err });
      await update({ status: 'failed', finishedAt: new Date(), error: { code: appErr.code, message: appErr.message } }).catch(() => undefined);
      await this.release(uid, job.id, {}).catch(() => undefined);
      this.library.invalidate(uid);
    }
  }

  async status(uid: string): Promise<SyncStatusDto> {
    const [user, latest] = await Promise.all([this.users.get(uid), this.jobs.latest(uid)]);
    const lockValid = Boolean(user?.activeSyncJobId && user.syncLockExpiresAt && user.syncLockExpiresAt.getTime() > Date.now());
    const active = lockValid && latest?.id === user?.activeSyncJobId && latest?.status === 'running' ? latest : null;
    return {
      active: active ? toJobDto(active) : null,
      latest: latest ? toJobDto(latest) : null,
      lastSuccessfulSyncAt: toIso(user?.lastSuccessfulSyncAt),
    };
  }

  /** Scheduled sync of stale users, processed sequentially within one request. */
  async runScheduled(maxUsers: number, staleAfterMs: number) {
    const candidates = await this.users.findAutoSyncCandidates(new Date(Date.now() - staleAfterMs), maxUsers);
    const results = { attempted: 0, skipped: 0 };
    for (const user of candidates) {
      try {
        const job = await this.acquire(user.uid, 'full', 'scheduled');
        results.attempted += 1;
        await this.run(user.uid, job);
      } catch (err) {
        results.skipped += 1;
        if (!(err instanceof AppError)) logger.error('scheduled sync failed', { uid: user.uid, error: err });
      }
    }
    return results;
  }
}
