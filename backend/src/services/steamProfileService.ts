import {
  STEAM_PERSONA_STATES, achievementTotals, libraryValue, steamCoverUrl,
  type CommunityVisibility, type SteamProfileDoc, type SteamProfileDto,
} from '@steam-analytics/shared';
import { errors, UpstreamError } from '../lib/errors';
import { toIso } from '../lib/firestore';
import { logger } from '../lib/logger';
import type { SteamDataRepository } from '../repositories/steamDataRepository';
import { toAnalyticsGame, type LibraryService } from './libraryService';
import type { SteamApiClient, SteamPlayer } from './steamApiClient';

/** Online status is considered fresh for this long. */
export const SUMMARY_TTL_MS = 60 * 1000;
const LEVEL_TTL_MS = 24 * 60 * 60 * 1000;

const visibility = (v: number): CommunityVisibility => (v === 3 ? 'public' : v === 2 ? 'friends_only' : 'private');

export function profileFromPlayer(player: SteamPlayer, previous: SteamProfileDoc | null, now: Date): SteamProfileDoc {
  return {
    steamId: player.steamid,
    personaName: player.personaname,
    avatarUrl: player.avatarfull,
    profileUrl: player.profileurl,
    personaState: STEAM_PERSONA_STATES[player.personastate ?? 0] ?? 'offline',
    communityVisibility: visibility(player.communityvisibilitystate),
    currentGame: player.gameextrainfo
      ? { appId: player.gameid && /^\d+$/.test(player.gameid) && player.gameid.length < 10 ? Number(player.gameid) : null, name: player.gameextrainfo }
      : null,
    steamLevel: previous?.steamLevel ?? null,
    gameDetailsVisible: previous?.gameDetailsVisible ?? null,
    summaryFetchedAt: now,
    levelFetchedAt: previous?.levelFetchedAt ?? null,
  };
}

export class SteamProfileService {
  constructor(
    private readonly steam: SteamApiClient,
    private readonly data: SteamDataRepository,
    private readonly library: LibraryService,
  ) {}

  /** Lightweight refresh: player summary (+ level once a day). */
  async refresh(uid: string, steamId: string, now = new Date()): Promise<SteamProfileDoc> {
    const previous = await this.data.getProfile(uid);
    const player = await this.steam.getPlayerSummary(steamId);
    if (!player) throw errors.steamUnavailable('Steam did not return this profile');
    const profile = profileFromPlayer(player, previous, now);
    if (!profile.levelFetchedAt || now.getTime() - profile.levelFetchedAt.getTime() > LEVEL_TTL_MS) {
      try {
        profile.steamLevel = await this.steam.getSteamLevel(steamId);
        profile.levelFetchedAt = now;
      } catch (err) {
        if (!(err instanceof UpstreamError)) throw err;
      }
    }
    await this.data.setProfile(uid, profile);
    return profile;
  }

  async getProfile(uid: string): Promise<{ dto: SteamProfileDto; source: 'live' | 'cache' }> {
    const user = await this.library.requireLinkedUser(uid);
    let profile = await this.data.getProfile(uid);
    let source: 'live' | 'cache' = 'cache';
    if (!profile || Date.now() - profile.summaryFetchedAt.getTime() > SUMMARY_TTL_MS) {
      try {
        profile = await this.refresh(uid, user.steamId);
        source = 'live';
      } catch (err) {
        if (!profile) throw err;
        logger.warn('profile refresh failed; serving cache', { uid, error: (err as Error).message });
      }
    }
    const lib = await this.library.load(uid);
    const hasLibrary = profile.gameDetailsVisible === true;
    const games = lib.entries.map(toAnalyticsGame);
    const ach = achievementTotals(games);
    const recentGames = lib.entries
      .filter((e) => e.game.playtime2WeeksMinutes > 0)
      .sort((a, b) => b.game.playtime2WeeksMinutes - a.game.playtime2WeeksMinutes)
      .slice(0, 6)
      .map((e) => ({
        appId: e.game.appId,
        name: e.game.name,
        coverUrl: steamCoverUrl(e.game.appId, e.meta?.headerImageUrl),
        playtime2WeeksMinutes: e.game.playtime2WeeksMinutes,
        playtimeForeverMinutes: e.game.playtimeForeverMinutes,
      }));
    const value = libraryValue(games, lib.region, toIso(lib.lastPriceUpdateAt));
    return {
      source,
      dto: {
        steamId: profile.steamId,
        personaName: profile.personaName,
        avatarUrl: profile.avatarUrl,
        profileUrl: profile.profileUrl,
        personaState: profile.personaState,
        communityVisibility: profile.communityVisibility,
        currentGame: profile.currentGame,
        steamLevel: profile.steamLevel,
        gameDetailsVisible: profile.gameDetailsVisible,
        summaryFetchedAt: profile.summaryFetchedAt.toISOString(),
        levelFetchedAt: toIso(profile.levelFetchedAt),
        library: {
          totalGames: hasLibrary ? games.length : null,
          totalPlaytimeMinutes: hasLibrary ? games.reduce((s, g) => s + g.playtimeMinutes, 0) : null,
          totalAchievementsUnlocked: ach.gamesWithData > 0 ? ach.totalUnlocked : null,
          gamesWithAchievementData: ach.gamesWithData,
          estimatedValue: hasLibrary && value.pricedGames > 0 ? value.totals : null,
          recentGames,
        },
      },
    };
  }
}
