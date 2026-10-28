import { describe, expect, it, vi } from 'vitest';
import { gameVisibilitySchema, type HiddenGameDoc, type PlaytimeSnapshotDoc, type UserDoc } from '@steam-analytics/shared';
import { AnalyticsService } from '../../src/services/analyticsService';
import { LibraryService, type Library, type LibraryEntry } from '../../src/services/libraryService';
import { SteamProfileService } from '../../src/services/steamProfileService';
import { mergeOwnedGame } from '../../src/services/syncService';
import type { SteamDataRepository } from '../../src/repositories/steamDataRepository';
import type { SteamApiClient } from '../../src/services/steamApiClient';
import type { UserRepository } from '../../src/repositories/userRepository';
import type { PurchaseRepository } from '../../src/repositories/purchaseRepository';
import type { AppCacheRepository } from '../../src/repositories/appCacheRepository';
import type { HiddenGameRepository } from '../../src/repositories/hiddenGameRepository';

const now = new Date();
const entry = (appId: number, minutes: number, hidden?: HiddenGameDoc): LibraryEntry => ({
  game: { ...mergeOwnedGame({ appid: appId, name: `Game ${appId}`, playtime_forever: minutes, playtime_2weeks: 30 }, undefined, now),
    achievements: { status: 'available', total: 10, unlocked: 5, syncedAt: now, syncedAtPlaytime: minutes } },
  meta: undefined, hidden,
  price: { status: 'priced', amount: appId * 10, currency: 'USD', initialAmount: appId * 10, discountPercent: 0, fetchedAt: now },
  purchase: { appId, amount: appId * 5, currency: 'USD', purchaseDate: null, source: 'steam', notes: '', createdAt: now, updatedAt: now },
});

function setup(entries = [entry(1, 60), entry(2, 120, { appId: 2, excludeFromStats: true }), entry(3, 180, { appId: 3, excludeFromStats: false })]) {
  const lib = {
    user: { steamId: '76561198000000001' } as UserDoc & { steamId: string },
    region: 'us', entries, hiddenGames: entries.flatMap((e) => e.hidden ? [e.hidden] : []), lastPriceUpdateAt: now,
  } satisfies Library;
  const snapshots: PlaytimeSnapshotDoc[] = [
    { date: '2026-10-01', capturedAt: now, totalMinutes: 60, games: { 1: 10, 2: 20, 3: 30 } },
    { date: '2026-10-02', capturedAt: now, totalMinutes: 360, games: { 1: 60, 2: 120, 3: 180 } },
  ];
  const library = { load: vi.fn(async () => lib), requireLinkedUser: vi.fn(async () => lib.user) } as unknown as LibraryService;
  const data = { listSnapshots: vi.fn(async () => snapshots), getProfile: vi.fn(async () => ({
    steamId: lib.user.steamId, personaName: 'Player', gameDetailsVisible: true, currentGame: { appId: 2, name: 'Game 2' }, summaryFetchedAt: new Date(),
  })) } as unknown as SteamDataRepository;
  return { lib, snapshots, analytics: new AnalyticsService(library, data), profiles: new SteamProfileService({} as SteamApiClient, data, library) };
}

describe('hidden games and statistics', () => {
  it('reloads visibility on another server instance when a user data version changes', async () => {
    const user = { dataVersion: 0, steamId: '76561198000000001', preferences: { storeRegion: 'us' } } as UserDoc;
    let hidden: HiddenGameDoc[] = [];
    const users = { get: async () => user } as unknown as UserRepository;
    const data = { listGames: async () => [entry(1, 60).game] } as unknown as SteamDataRepository;
    const purchases = { list: async () => [] } as unknown as PurchaseRepository;
    const cache = { getMetadata: async () => new Map(), getPrices: async () => new Map() } as unknown as AppCacheRepository;
    const choices = { list: async () => hidden } as unknown as HiddenGameRepository;
    const first = new LibraryService(users, data, purchases, cache, choices);
    const second = new LibraryService(users, data, purchases, cache, choices);
    expect((await first.load('alice')).entries[0]?.hidden).toBeUndefined();
    expect((await second.load('alice')).entries[0]?.hidden).toBeUndefined();
    hidden = [{ appId: 1, excludeFromStats: true }];
    user.dataVersion += 1;
    expect((await second.load('alice')).entries[0]?.hidden?.excludeFromStats).toBe(true);
    hidden = [];
    user.dataVersion += 1;
    expect((await first.load('alice')).entries[0]?.hidden).toBeUndefined();
  });

  it('excludes only games opted out of statistics from every aggregate and ranking', async () => {
    const { analytics } = setup();
    const overview = (await analytics.overview('alice')).dto;
    expect(overview).toMatchObject({ totalGames: 2, totalPlaytimeMinutes: 240, mostPlayed: { appId: 3 }, achievements: { totalUnlocked: 10, totalAvailable: 20 }, recordedSpending: [{ currency: 'USD', amount: 20, count: 2 }] });
    expect(overview.mostExpensive.map((g) => g.appId)).toEqual([3, 1]);
    expect(overview.bestValue.map((g) => g.appId)).not.toContain(2);
    const achievements = (await analytics.achievements('alice')).dto;
    expect(achievements.byGame.map((g) => g.appId)).toEqual([1, 3]);
    const value = (await analytics.libraryValue('alice')).dto;
    expect(value.estimated.totals).toEqual([{ currency: 'USD', amount: 40, count: 2 }]);
    expect(value.recorded.purchaseCount).toBe(2);
    for (const basis of ['actual', 'estimated'] as const) {
      expect((await analytics.costEfficiency('alice', basis)).dto.items.map((g) => g.appId)).not.toContain(2);
    }
  });

  it('excludes the same AppIDs from all historical snapshots without mutating stored history', async () => {
    const { analytics, snapshots, lib } = setup();
    // Choices still apply to history if Steam no longer returns the game as owned.
    lib.hiddenGames.push({ appId: 99, excludeFromStats: true });
    snapshots[1]!.games['99'] = 1000;
    const playtime = (await analytics.playtime('alice')).dto;
    expect(playtime.totalPlaytimeMinutes).toBe(240);
    expect(playtime.trend.daily).toEqual([{ date: '2026-10-02', minutes: 200 }]);
    expect(playtime.trend.monthly).toEqual([{ month: '2026-10', minutes: 200 }]);
    expect(snapshots[1]!.games['2']).toBe(120);
    expect(snapshots[1]!.games['99']).toBe(1000);
  });

  it('counts only included bundle shares and counts a partly included bundle once', async () => {
    const { analytics, lib } = setup();
    const bundle = { id: 'bundle-1', total: 15, itemCount: 2, allocation: 'even' as const };
    lib.entries[0]!.purchase!.bundle = bundle;
    lib.entries[1]!.purchase!.bundle = bundle;
    expect((await analytics.libraryValue('alice')).dto.recorded).toMatchObject({
      totals: [{ currency: 'USD', amount: 20, count: 2 }], purchaseCount: 2, bundleCount: 1,
    });
    lib.entries[0]!.hidden = { appId: 1, excludeFromStats: true };
    expect((await analytics.libraryValue('alice')).dto.recorded).toMatchObject({
      totals: [{ currency: 'USD', amount: 15, count: 1 }], purchaseCount: 1, bundleCount: 0,
    });
  });

  it('hides games from recent/current activity while using the chosen statistics totals', async () => {
    const { profiles } = setup();
    const { dto } = await profiles.getProfile('alice');
    expect(dto.currentGame).toBeNull();
    expect(dto.library).toMatchObject({ totalGames: 2, totalPlaytimeMinutes: 240, totalAchievementsUnlocked: 10 });
    expect(dto.library.recentGames.map((g) => g.appId)).toEqual([1]);
  });

  it('handles hiding everything and restoring a game', async () => {
    const { analytics, lib } = setup([entry(1, 60, { appId: 1, excludeFromStats: true })]);
    expect((await analytics.overview('alice')).dto).toMatchObject({ totalGames: 0, totalPlaytimeMinutes: 0, mostPlayed: null });
    expect((await analytics.libraryValue('alice')).dto.estimated.totals).toEqual([]);
    lib.entries[0]!.hidden = undefined;
    lib.hiddenGames = [];
    expect((await analytics.overview('alice')).dto.totalGames).toBe(1);
  });

  it('defaults hiding to exclusion and rejects attempts to edit trusted Steam data', () => {
    expect(gameVisibilitySchema.parse({ hidden: true })).toEqual({ hidden: true, excludeFromStats: true });
    expect(gameVisibilitySchema.safeParse({ hidden: 'true' }).success).toBe(false);
    expect(gameVisibilitySchema.safeParse({ hidden: true, playtimeForeverMinutes: 0 }).success).toBe(false);
  });
});
