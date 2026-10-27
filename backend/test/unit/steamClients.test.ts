import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/lib/errors';
import { TokenBucket } from '../../src/lib/http';
import { SteamApiClient } from '../../src/services/steamApiClient';
import { SteamStoreClient } from '../../src/services/steamStoreClient';
import { effectivePrice } from '../../src/services/pricingService';
import { FakeSteam } from '../helpers/fakeSteam';

const KEY = 'A'.repeat(32);
const fast = () => new TokenBucket(1000, 1000);

function setup() {
  const steam = new FakeSteam();
  steam.addPlayer({
    steamId: '76561198000000001', name: 'Public', visibility: 3, gameDetailsPublic: true, level: 42,
    games: [{ appid: 10, name: 'Game', playtime_forever: 120, has_community_visible_stats: true }],
    unlocked: { 10: ['A'] },
  });
  steam.addPlayer({ steamId: '76561198000000002', name: 'Private', visibility: 1, gameDetailsPublic: false, games: [], unlocked: {}, achievementsPrivate: true });
  steam.apps.set(10, { achievements: ['A', 'B'], priceCents: 1999 });
  steam.apps.set(20, { isFree: true });
  steam.apps.set(30, { priceCents: null });
  const api = new SteamApiClient({ apiKey: KEY, fetchImpl: steam.fetch, limiter: fast(), retries: 2 });
  const store = new SteamStoreClient({ fetchImpl: steam.fetch, limiter: fast(), retries: 1 });
  return { steam, api, store };
}

describe('SteamApiClient (mocked responses)', () => {
  it('parses public owned games', async () => {
    const { api } = setup();
    const r = await api.getOwnedGames('76561198000000001');
    expect(r.visible).toBe(true);
    expect(r.games[0]).toMatchObject({ appid: 10, playtime_forever: 120 });
  });

  it('reports private game details as not visible (not as zero games)', async () => {
    const { api } = setup();
    expect(await api.getOwnedGames('76561198000000002')).toEqual({ visible: false, games: [] });
    expect(await api.getSteamLevel('76561198000000002')).toBeNull();
  });

  it('classifies player achievement responses', async () => {
    const { api } = setup();
    const ok = await api.getPlayerAchievements('76561198000000001', 10, 'en');
    expect(ok).toEqual({ status: 'ok', achievements: [{ apiName: 'A', achieved: true, unlockTime: 1_700_000_000 }, { apiName: 'B', achieved: false, unlockTime: 0 }] });
    expect(await api.getPlayerAchievements('76561198000000001', 99, 'en')).toEqual({ status: 'no_stats' });
    expect(await api.getPlayerAchievements('76561198000000002', 10, 'en')).toEqual({ status: 'private' });
  });

  it('returns schema and global percentages', async () => {
    const { api } = setup();
    const schema = await api.getSchemaForGame(10, 'zh-CN');
    expect(schema.map((a) => a.apiName)).toEqual(['A', 'B']);
    expect(await api.getGlobalAchievementPercentages(10)).toEqual({ A: 50, B: 49 });
    expect(await api.getGlobalAchievementPercentages(99)).toBeNull();
    expect(await api.getSchemaForGame(99, 'en')).toEqual([]);
  });

  it('retries transient failures and then raises UpstreamError without leaking the key', async () => {
    const { steam, api } = setup();
    steam.failures.set('GetPlayerSummaries', 503);
    const err = await api.getPlayerSummary('76561198000000001').catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(String(err.message)).not.toContain(KEY);
    expect(steam.calls.filter((c) => c.includes('GetPlayerSummaries'))).toHaveLength(3);
  });

  it('does not retry non-retryable errors', async () => {
    const { steam, api } = setup();
    steam.failures.set('GetOwnedGames', 401);
    await expect(api.getOwnedGames('76561198000000001')).rejects.toMatchObject({ status: 401 });
    expect(steam.calls.filter((c) => c.includes('GetOwnedGames'))).toHaveLength(1);
  });

  it('rejects unexpected response shapes', async () => {
    const { steam, api } = setup();
    steam.overrides.push({ match: 'GetSteamLevel', handler: () => new Response('{"response":{"player_level":"x"}}') });
    await expect(api.getSteamLevel('76561198000000001')).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('SteamStoreClient', () => {
  it('distinguishes priced, no-price and unavailable apps', async () => {
    const { store } = setup();
    const prices = await store.getPrices([10, 20, 30], 'us');
    expect(prices.map((p) => [p.appId, p.status, p.finalMinor])).toEqual([[10, 'priced', 1999], [20, 'no_price', null], [30, 'unavailable', null]]);
  });

  it('reads type and free flag', async () => {
    const { store } = setup();
    expect(await store.getAppBasics(20, 'us')).toMatchObject({ available: true, isFree: true, type: 'game' });
    expect(await store.getAppBasics(30, 'us')).toMatchObject({ available: false });
  });
});

describe('effectivePrice', () => {
  const now = new Date();
  const price = (status: 'priced' | 'no_price' | 'unavailable') => ({
    appId: 1, region: 'us', status, currency: status === 'priced' ? 'USD' : null,
    initialMinor: status === 'priced' ? 5999 : null, finalMinor: status === 'priced' ? 2999 : null, discountPercent: 50, fetchedAt: now,
  });
  const meta = (isFree: boolean | null) => ({ appId: 1, type: 'game', isFree, name: 'x', storeStatus: 'ok' as const, fetchedAt: now });

  it('maps store data to user-facing statuses', () => {
    expect(effectivePrice(undefined, undefined).status).toBe('unknown');
    expect(effectivePrice(undefined, price('priced'))).toMatchObject({ status: 'priced', amount: 29.99, initialAmount: 59.99 });
    expect(effectivePrice(meta(true), price('no_price')).status).toBe('free');
    expect(effectivePrice(meta(false), price('no_price')).status).toBe('unavailable');
    expect(effectivePrice(undefined, price('no_price')).status).toBe('unknown');
    expect(effectivePrice(meta(null), price('unavailable')).status).toBe('unavailable');
  });
});
