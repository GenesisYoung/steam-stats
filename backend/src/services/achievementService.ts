import {
  achievementPercent, type AchievementSchemaDoc, type GameAchievementsDto, type OwnedGameDoc,
} from '@steam-analytics/shared';
import { UpstreamError } from '../lib/errors';
import { toIso } from '../lib/firestore';
import type { AppCacheRepository } from '../repositories/appCacheRepository';
import type { SteamDataRepository } from '../repositories/steamDataRepository';
import type { SteamApiClient } from './steamApiClient';

export const SCHEMA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PRIVATE_RETRY_MS = 24 * 60 * 60 * 1000;
const NONE_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

const ICON_BASE = 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps';
const iconUrl = (appId: number, icon: string | null) =>
  !icon ? null : /^https?:\/\//.test(icon) ? icon : `${ICON_BASE}/${appId}/${icon}`;

/** Whether a game's achievement data should be (re)fetched during sync. */
export function needsAchievementSync(game: OwnedGameDoc, now = Date.now()): boolean {
  const a = game.achievements;
  const age = a.syncedAt ? now - a.syncedAt.getTime() : Number.POSITIVE_INFINITY;
  switch (a.status) {
    case 'unknown':
    case 'error':
      return true;
    case 'available':
      return a.syncedAtPlaytime !== game.playtimeForeverMinutes;
    case 'private':
      return age > PRIVATE_RETRY_MS;
    case 'none':
      return game.hasCommunityVisibleStats === true && age > NONE_RETRY_MS;
  }
}

export type GameSyncOutcome = 'available' | 'none' | 'private' | 'error';

export class AchievementService {
  constructor(
    private readonly steam: SteamApiClient,
    private readonly cache: AppCacheRepository,
    private readonly data: SteamDataRepository,
  ) {}

  /** Achievement definitions + global percentages, cached in the shared collection. */
  async getSchema(appId: number, language: string, now = new Date()): Promise<AchievementSchemaDoc> {
    const cached = await this.cache.getSchema(appId, language);
    if (cached && now.getTime() - cached.fetchedAt.getTime() < SCHEMA_TTL_MS) return cached;
    try {
      const [achievements, globalPercentages] = await Promise.all([
        this.steam.getSchemaForGame(appId, language),
        this.steam.getGlobalAchievementPercentages(appId),
      ]);
      const doc: AchievementSchemaDoc = { appId, language, achievements, globalPercentages, fetchedAt: now };
      await this.cache.setSchema(doc);
      return doc;
    } catch (err) {
      if (cached) return cached; // stale but usable
      throw err;
    }
  }

  /** Fetch and store one game's player achievements; updates the game summary. */
  async syncGame(uid: string, steamId: string, game: OwnedGameDoc, language: string, now = new Date()): Promise<GameSyncOutcome> {
    const base = { syncedAt: now, syncedAtPlaytime: game.playtimeForeverMinutes };
    if (game.hasCommunityVisibleStats !== true) {
      await this.data.patchGame(uid, game.appId, { achievements: { status: 'none', total: 0, unlocked: 0, ...base } });
      return 'none';
    }
    try {
      const schema = await this.getSchema(game.appId, language, now);
      if (schema.achievements.length === 0) {
        await this.data.patchGame(uid, game.appId, { achievements: { status: 'none', total: 0, unlocked: 0, ...base } });
        return 'none';
      }
      const result = await this.steam.getPlayerAchievements(steamId, game.appId, language);
      if (result.status !== 'ok') {
        const status = result.status === 'private' ? 'private' : 'none';
        await this.data.patchGame(uid, game.appId, {
          achievements: { status, total: status === 'none' ? 0 : null, unlocked: status === 'none' ? 0 : null, ...base },
        });
        return status;
      }
      const unlocked: Record<string, number> = {};
      for (const a of result.achievements) if (a.achieved) unlocked[a.apiName] = a.unlockTime;
      const total = result.achievements.length;
      await this.data.setAchievementState(
        uid,
        { appId: game.appId, unlocked, syncedAt: now },
        { achievements: { status: total > 0 ? 'available' : 'none', total, unlocked: Object.keys(unlocked).length, ...base } },
      );
      return total > 0 ? 'available' : 'none';
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err;
      await this.data.patchGame(uid, game.appId, {
        achievements: { ...game.achievements, status: game.achievements.status === 'available' ? 'available' : 'error' },
      });
      return 'error';
    }
  }

  /** Detailed achievement list for one game, syncing on demand when missing or outdated. */
  async getGameAchievements(uid: string, steamId: string, game: OwnedGameDoc, language: string): Promise<GameAchievementsDto> {
    if (needsAchievementSync(game)) {
      await this.syncGame(uid, steamId, game, language);
      game = (await this.data.getGame(uid, game.appId)) ?? game;
    }
    const status = game.achievements.status;
    if (status !== 'available') {
      return { appId: game.appId, status, total: game.achievements.total ?? 0, unlocked: 0, percent: null, achievements: [], syncedAt: toIso(game.achievements.syncedAt) };
    }
    const [schema, state] = await Promise.all([
      this.getSchema(game.appId, language).catch(() => null),
      this.data.getAchievementState(uid, game.appId),
    ]);
    const unlockedMap = state?.unlocked ?? {};
    const definitions = schema?.achievements.length
      ? schema.achievements
      : Object.keys(unlockedMap).map((apiName) => ({ apiName, displayName: apiName, description: null, icon: null, iconGray: null, hidden: false }));
    const achievements = definitions.map((d) => {
      const unlockTime = unlockedMap[d.apiName];
      const unlocked = unlockTime !== undefined;
      return {
        apiName: d.apiName,
        displayName: d.displayName,
        description: d.description,
        iconUrl: iconUrl(game.appId, unlocked ? d.icon : d.iconGray ?? d.icon),
        hidden: d.hidden,
        unlocked,
        unlockedAt: unlocked && unlockTime > 0 ? new Date(unlockTime * 1000).toISOString() : null,
        globalPercent: schema?.globalPercentages?.[d.apiName] ?? null,
      };
    });
    const total = game.achievements.total ?? achievements.length;
    const unlockedCount = game.achievements.unlocked ?? Object.keys(unlockedMap).length;
    return {
      appId: game.appId,
      status,
      total,
      unlocked: unlockedCount,
      percent: achievementPercent(total, unlockedCount),
      achievements,
      syncedAt: toIso(state?.syncedAt ?? game.achievements.syncedAt),
    };
  }
}
