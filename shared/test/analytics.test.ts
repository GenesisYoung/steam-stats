import { describe, expect, it } from 'vitest';
import {
  achievementTotals, averageCostPerHour, costPerHour, libraryValue, playtimeDistribution,
  purchaseInputSchema, snapshotDeltas, sumByCurrency, summarizePlaytime, type AnalyticsGame,
} from '../src';

const game = (over: Partial<AnalyticsGame> & { appId: number }): AnalyticsGame => ({
  name: `Game ${over.appId}`,
  playtimeMinutes: 0,
  achievements: { status: 'unknown', total: null, unlocked: null },
  price: { status: 'unknown', amount: null, currency: null },
  purchase: null,
  ...over,
});

describe('costPerHour', () => {
  it('matches the spec example ($59.99 / 120h ≈ $0.50/h)', () => {
    const r = costPerHour({ amount: 59.99, currency: 'USD' }, 'priced', 120 * 60);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.value.amount).toBeCloseTo(0.4999, 3);
  });

  it('returns not_played instead of dividing by zero', () => {
    expect(costPerHour({ amount: 20, currency: 'USD' }, 'priced', 0)).toEqual({ status: 'not_played' });
  });

  it('distinguishes free and unknown prices', () => {
    expect(costPerHour(null, 'free', 100)).toEqual({ status: 'free' });
    expect(costPerHour(null, 'unknown', 100)).toEqual({ status: 'no_price' });
    expect(costPerHour(null, 'unavailable', 100)).toEqual({ status: 'no_price' });
  });

  it('treats a recorded purchase of 0 as free', () => {
    expect(costPerHour({ amount: 0, currency: 'EUR' }, 'recorded', 60)).toEqual({ status: 'free' });
  });
});

describe('summarizePlaytime', () => {
  it('sums minutes and converts to shares', () => {
    const s = summarizePlaytime([
      game({ appId: 1, playtimeMinutes: 600 }),
      game({ appId: 2, playtimeMinutes: 300 }),
      game({ appId: 3, playtimeMinutes: 0 }),
      game({ appId: 4, playtimeMinutes: 100 }),
    ]);
    expect(s.totalPlaytimeMinutes).toBe(1000);
    expect(s.playedGames).toBe(3);
    expect(s.unplayedGames).toBe(1);
    expect(s.averagePlaytimePerPlayedGameMinutes).toBeCloseTo(333.33, 1);
    expect(s.mostPlayed).toMatchObject({ appId: 1, share: 60 });
    expect(s.top.map((g) => g.appId)).toEqual([1, 2, 4]);
  });

  it('handles an empty or fully unplayed library', () => {
    const s = summarizePlaytime([game({ appId: 1 })]);
    expect(s.totalPlaytimeMinutes).toBe(0);
    expect(s.averagePlaytimePerPlayedGameMinutes).toBeNull();
    expect(s.mostPlayed).toBeNull();
  });
});

describe('playtimeDistribution', () => {
  it('places games in the right buckets', () => {
    const d = playtimeDistribution([
      { playtimeMinutes: 0 }, { playtimeMinutes: 30 }, { playtimeMinutes: 60 }, { playtimeMinutes: 6000 }, { playtimeMinutes: 60_000 },
    ]);
    expect(Object.fromEntries(d.map((b) => [b.bucket, b.count]))).toEqual({
      '0h': 1, '<1h': 1, '1-10h': 1, '10-50h': 0, '50-100h': 0, '100-500h': 1, '500h+': 1,
    });
  });
});

describe('libraryValue', () => {
  it('never counts unknown prices as zero and never mixes currencies', () => {
    const v = libraryValue([
      game({ appId: 1, price: { status: 'priced', amount: 59.99, currency: 'USD' } }),
      game({ appId: 2, price: { status: 'priced', amount: 0.01, currency: 'USD' } }),
      game({ appId: 3, price: { status: 'priced', amount: 10, currency: 'EUR' } }),
      game({ appId: 4, price: { status: 'free', amount: null, currency: null } }),
      game({ appId: 5, price: { status: 'unavailable', amount: null, currency: null } }),
      game({ appId: 6 }),
      game({ appId: 7, isGame: false, price: { status: 'priced', amount: 99, currency: 'USD' } }),
    ], 'us', null);
    expect(v.totals).toEqual([
      { currency: 'USD', amount: 60, count: 2 },
      { currency: 'EUR', amount: 10, count: 1 },
    ]);
    expect(v).toMatchObject({ pricedGames: 3, freeGames: 1, unavailableGames: 1, unknownGames: 1, excludedNonGames: 1 });
  });
});

describe('sumByCurrency / averageCostPerHour', () => {
  it('groups by currency', () => {
    expect(sumByCurrency([{ amount: 0.1, currency: 'USD' }, { amount: 0.2, currency: 'USD' }])).toEqual([
      { currency: 'USD', amount: 0.3, count: 1 + 1 },
    ]);
  });

  it('excludes unplayed games from the average', () => {
    const avg = averageCostPerHour([
      { price: { amount: 60, currency: 'USD' }, playtimeMinutes: 60 * 60 },
      { price: { amount: 40, currency: 'USD' }, playtimeMinutes: 0 },
      { price: null, playtimeMinutes: 600 },
    ]);
    expect(avg).toEqual([{ currency: 'USD', amount: 1 }]);
  });
});

describe('achievementTotals', () => {
  it('computes completion only over games with known data', () => {
    const t = achievementTotals([
      game({ appId: 1, achievements: { status: 'available', total: 10, unlocked: 10 } }),
      game({ appId: 2, achievements: { status: 'available', total: 30, unlocked: 0 } }),
      game({ appId: 3, achievements: { status: 'none', total: 0, unlocked: 0 } }),
      game({ appId: 4, achievements: { status: 'private', total: null, unlocked: null } }),
      game({ appId: 5 }),
    ]);
    expect(t).toEqual({
      totalUnlocked: 10, totalAvailable: 40, completionRate: 25, gamesWithData: 2,
      gamesWithoutAchievements: 1, gamesPendingSync: 1, gamesPrivateOrError: 1, perfectGames: 1,
    });
  });

  it('returns null completion when nothing is known', () => {
    expect(achievementTotals([game({ appId: 1 })]).completionRate).toBeNull();
  });
});

describe('snapshotDeltas', () => {
  it('reports only activity after tracking started', () => {
    const r = snapshotDeltas([
      { date: '2026-10-02', games: { '1': 130, '2': 50 } },
      { date: '2026-10-01', games: { '1': 100 } },
      { date: '2026-11-01', games: { '1': 120, '2': 80 } },
    ]);
    expect(r.trackingStartedAt).toBe('2026-10-01');
    // 10-02: +30 (game 1) +50 (new game 2); 11-01: game 1 decreased (ignored), game 2 +30
    expect(r.daily).toEqual([{ date: '2026-10-02', minutes: 80 }, { date: '2026-11-01', minutes: 30 }]);
    expect(r.monthly).toEqual([{ month: '2026-10', minutes: 80 }, { month: '2026-11', minutes: 30 }]);
  });

  it('returns no trend for a single snapshot', () => {
    expect(snapshotDeltas([{ date: '2026-10-01', games: { '1': 100 } }]).daily).toEqual([]);
  });
});

describe('purchaseInputSchema', () => {
  it('accepts valid input and applies defaults', () => {
    expect(purchaseInputSchema.parse({ amount: 19.99, currency: 'USD' })).toEqual({
      amount: 19.99, currency: 'USD', purchaseDate: null, source: 'steam', notes: '',
    });
  });

  it('rejects bad input', () => {
    expect(purchaseInputSchema.safeParse({ amount: -1, currency: 'USD' }).success).toBe(false);
    expect(purchaseInputSchema.safeParse({ amount: 1.234, currency: 'USD' }).success).toBe(false);
    expect(purchaseInputSchema.safeParse({ amount: 1, currency: 'XXX' }).success).toBe(false);
    expect(purchaseInputSchema.safeParse({ amount: 1, currency: 'USD', extra: 1 }).success).toBe(false);
    expect(purchaseInputSchema.safeParse({ amount: 1, currency: 'USD', purchaseDate: '2999-01-01' }).success).toBe(false);
  });
});
