import { describe, expect, it } from 'vitest';
import { gameListQuerySchema, type GameListItemDto } from '@steam-analytics/shared';
import { queryGames } from '../../src/services/libraryService';
import { mergeOwnedGame } from '../../src/services/syncService';
import { needsAchievementSync } from '../../src/services/achievementService';
import { redact } from '../../src/lib/logger';

const item = (appId: number, name: string, minutes: number, price: number | null, ach: number | null): GameListItemDto => ({
  appId, name, hidden: false, excludedFromStats: false, coverUrl: '', iconUrl: null, playtimeForeverMinutes: minutes, playtimeHours: minutes / 60, playtime2WeeksMinutes: 0, lastPlayedAt: null,
  achievements: { status: ach === null ? 'unknown' : 'available', total: ach === null ? null : 10, unlocked: ach === null ? null : ach / 10, percent: ach },
  price: { status: price === null ? 'unknown' : 'priced', price: price === null ? null : { amount: price, currency: 'USD' }, initialPrice: null, discountPercent: null, region: 'us', fetchedAt: null },
  estimatedCostPerHour: price !== null && minutes > 0 ? { status: 'ok', value: { amount: price / (minutes / 60), currency: 'USD' } } : minutes === 0 ? { status: 'not_played' } : { status: 'no_price' },
  purchase: null, actualCostPerHour: null,
});

const items = [item(1, 'Beta', 600, 20, 50), item(2, 'alpha', 0, 10, null), item(3, 'Gamma', 60, null, 100), item(4, 'Delta', 1200, 60, 0)];
const q = (o: Record<string, unknown>) => gameListQuerySchema.parse(o);

describe('queryGames', () => {
  it('sorts by playtime desc by default', () => {
    expect(queryGames(items, q({})).items.map((g) => g.appId)).toEqual([4, 1, 3, 2]);
  });
  it('sorts alphabetically case-insensitively', () => {
    expect(queryGames(items, q({ sort: 'name' })).items.map((g) => g.name)).toEqual(['alpha', 'Beta', 'Delta', 'Gamma']);
  });
  it('keeps unknown values last in both directions', () => {
    expect(queryGames(items, q({ sort: 'price', order: 'asc' })).items.map((g) => g.appId)).toEqual([2, 1, 4, 3]);
    expect(queryGames(items, q({ sort: 'price', order: 'desc' })).items.map((g) => g.appId)).toEqual([4, 1, 2, 3]);
    expect(queryGames(items, q({ sort: 'achievements' })).items.map((g) => g.appId)).toEqual([3, 1, 4, 2]);
  });
  it('sorts by cost per hour ascending (best value first), unplayed last', () => {
    expect(queryGames(items, q({ sort: 'costPerHour' })).items.map((g) => g.appId)).toEqual([1, 4, 2, 3]);
  });
  it('filters and searches', () => {
    expect(queryGames(items, q({ played: 'no' })).items.map((g) => g.appId)).toEqual([2]);
    expect(queryGames(items, q({ achievements: 'yes' })).total).toBe(3);
    expect(queryGames(items, q({ q: 'ALP' })).items.map((g) => g.appId)).toEqual([2]);
  });
  it('paginates', () => {
    const r = queryGames(items, q({ page: 2, pageSize: 3 }));
    expect(r.total).toBe(4);
    expect(r.items.map((g) => g.appId)).toEqual([2]);
  });

  it('filters visibility before counting and paginating, including search results', () => {
    const games = items.map((g, i) => ({ ...g, hidden: i < 2, excludedFromStats: i === 0 }));
    expect(queryGames(games, q({})).items.map((g) => g.appId)).toEqual([4, 3]);
    expect(queryGames(games, q({ visibility: 'hidden' })).total).toBe(2);
    expect(queryGames(games, q({ visibility: 'hidden', pageSize: 1 })).items[0]?.appId).toBe(1);
    expect(queryGames(games, q({ visibility: 'all' })).total).toBe(4);
    expect(queryGames(games, q({ q: 'Beta' })).total).toBe(0);
    expect(queryGames(games, q({ visibility: 'hidden', q: 'Beta' })).total).toBe(1);
  });
});

describe('mergeOwnedGame / needsAchievementSync', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  it('treats a missing playtime_2weeks as zero and rtime 0 as unknown', () => {
    const g = mergeOwnedGame({ appid: 5, name: 'X', playtime_forever: 0, rtime_last_played: 0 }, undefined, now);
    expect(g.playtime2WeeksMinutes).toBe(0);
    expect(g.lastPlayedAt).toBeNull();
    expect(g.achievements.status).toBe('unknown');
    expect(needsAchievementSync(g, now.getTime())).toBe(true);
  });
  it('re-syncs achievements only when playtime changed', () => {
    const prev = mergeOwnedGame({ appid: 5, name: 'X', playtime_forever: 100 }, undefined, now);
    prev.achievements = { status: 'available', total: 5, unlocked: 1, syncedAt: now, syncedAtPlaytime: 100 };
    expect(needsAchievementSync(prev, now.getTime())).toBe(false);
    const next = mergeOwnedGame({ appid: 5, name: 'X', playtime_forever: 130 }, prev, now);
    expect(next.achievements.status).toBe('available');
    expect(needsAchievementSync(next, now.getTime())).toBe(true);
  });
});

describe('logger redaction', () => {
  it('removes keys, tokens and emails', () => {
    const out = redact({ msg: 'GET /x?key=SECRET&a=1 by a@b.com', authorization: 'Bearer abc.def', nested: { token: 't' } });
    expect(JSON.stringify(out)).not.toMatch(/SECRET|a@b\.com|abc\.def|"t"/);
  });
});
