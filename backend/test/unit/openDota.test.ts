import { describe, expect, it, vi } from 'vitest';
import type { UserDoc } from '@steam-analytics/shared';
import { UpstreamError } from '../../src/lib/errors';
import { TokenBucket, type FetchLike } from '../../src/lib/http';
import { OpenDotaClient } from '../../src/services/openDotaClient';
import { DotaService } from '../../src/services/dotaService';
import type { LibraryService } from '../../src/services/libraryService';

const STEAM_ID = '76561198047544485';
const ACCOUNT = 87278757;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const rawSummary = (over: Record<string, unknown> = {}) => ({
  match_id: 10, player_slot: 130, radiant_win: true, duration: 1800, game_mode: 22, lobby_type: 7, hero_id: 1, start_time: 1_700_000_000,
  kills: 1, deaths: 2, assists: 3, gold_per_min: 400, xp_per_min: 500, hero_damage: 1000, tower_damage: 10, hero_healing: 0, last_hits: 50, party_size: null,
  ...over,
});

const rawPlayer = (over: Record<string, unknown> = {}) => ({ account_id: ACCOUNT, personaname: 'Me', hero_id: 1, player_slot: 0, kills: 1, deaths: 2, assists: 3, item_0: 1, item_1: 0, ...over });
const rawMatch = (over: Record<string, unknown> = {}) => ({
  match_id: 10, start_time: 1_700_000_000, duration: 1800, game_mode: 22, lobby_type: 7, radiant_win: true, radiant_score: 3, dire_score: 2,
  od_data: { has_parsed: true }, radiant_gold_adv: [0, 100], radiant_xp_adv: null, players: [rawPlayer()],
  ...over,
});

function fakeOpenDota(routes: Record<string, () => Response> = {}) {
  const calls: { path: string; search: URLSearchParams; method: string }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/api', '');
    calls.push({ path, search: url.searchParams, method: init?.method ?? 'GET' });
    if (routes[path]) return routes[path]();
    if (path === '/constants/heroes') return json({ 1: { id: 1, localized_name: 'Anti-Mage', img: '/apps/dota2/images/dota_react/heroes/antimage.png?', icon: 'https://evil.example/x.png' } });
    if (path === '/constants/items') return json({ blink: { id: 1, dname: 'Blink Dagger', img: '/apps/dota2/images/dota_react/items/blink.png?t=1', cost: 2250 } });
    if (path === `/players/${ACCOUNT}`) return json({ profile: { personaname: 'Me' }, rank_tier: 45 });
    if (path === `/players/${ACCOUNT}/matches`) return json([rawSummary()]);
    if (path === '/matches/10') return json(rawMatch());
    return json({ error: 'Not Found' }, 404);
  };
  const client = new OpenDotaClient({ fetchImpl, limiter: new TokenBucket(1000, 1000), retries: 1 });
  return { client, calls };
}

function service(routes?: Record<string, () => Response>, steamId: string | null = STEAM_ID) {
  const fake = fakeOpenDota(routes);
  const library = { requireLinkedUser: vi.fn(async () => ({ steamId }) as UserDoc & { steamId: string }) } as unknown as LibraryService;
  return { ...fake, dota: new DotaService(fake.client, library) };
}

describe('OpenDotaClient', () => {
  it('requests all game modes and only the needed fields', async () => {
    const { client, calls } = fakeOpenDota();
    const [m] = await client.getMatchHistory(ACCOUNT);
    const search = calls[0]!.search;
    expect(search.get('significant')).toBe('0');
    expect(search.getAll('project')).toContain('hero_id');
    expect(m).toMatchObject({ matchId: 10, playerSlot: 130, gpm: 400, partySize: null });
  });

  it('treats an unknown player or match as missing, not as an error', async () => {
    const { client } = fakeOpenDota();
    await expect(client.getPlayer(1)).resolves.toBeNull();
    await expect(client.getMatch(1)).resolves.toBeNull();
    await expect(client.getMatchHistory(1)).resolves.toEqual([]);
  });

  it('normalizes a match without replay data', async () => {
    const { client } = fakeOpenDota({ '/matches/11': () => json(rawMatch({ match_id: 11, od_data: { has_parsed: false }, radiant_gold_adv: null, players: [rawPlayer({ account_id: null })] })) });
    const m = await client.getMatch(11);
    expect(m!.parsed).toBe(false);
    expect(m!.radiantGoldAdvantage).toEqual([]);
    expect(m!.players[0]).toMatchObject({ accountId: null, purchaseLog: [], goldTimeline: [], laneEfficiencyPct: null });
  });

  it('treats the zeros old matches report for missing data as unknown', async () => {
    const { client } = fakeOpenDota({ '/matches/12': () => json(rawMatch({ match_id: 12, radiant_score: 0, dire_score: 0, players: [rawPlayer({ net_worth: 0 })] })) });
    const m = await client.getMatch(12);
    expect(m).toMatchObject({ radiantScore: null, direScore: null });
    expect(m!.players[0]!.netWorth).toBeNull();
  });

  it('keeps a real score of zero for one team', async () => {
    const { client } = fakeOpenDota({ '/matches/13': () => json(rawMatch({ match_id: 13, radiant_score: 12, dire_score: 0 })) });
    expect(await client.getMatch(13)).toMatchObject({ radiantScore: 12, direScore: 0 });
  });

  it('drops empty item slots', async () => {
    const { client } = fakeOpenDota();
    expect((await client.getMatch(10))!.players[0]!.itemIds).toEqual([1]);
  });

  it('rejects a malformed response', async () => {
    const { client } = fakeOpenDota({ [`/players/${ACCOUNT}/matches`]: () => json({ unexpected: true }) });
    await expect(client.getMatchHistory(ACCOUNT)).rejects.toBeInstanceOf(UpstreamError);
  });

  it('only accepts image paths on the Dota CDN', async () => {
    const { client } = fakeOpenDota();
    const [hero] = await client.getHeroes();
    expect(hero!.imageUrl).toBe('https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/antimage.png');
    expect(hero!.iconUrl).toBeNull();
  });

  it('sends the optional API key only when configured', async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (input) => { urls.push(String(input)); return json({ profile: null }); };
    await new OpenDotaClient({ apiKey: 'k1', fetchImpl, limiter: new TokenBucket(10, 10) }).getPlayer(5);
    await new OpenDotaClient({ fetchImpl, limiter: new TokenBucket(10, 10) }).getPlayer(5);
    expect(urls[0]).toContain('api_key=k1');
    expect(urls[1]).not.toContain('api_key');
  });
});

describe('DotaService', () => {
  const overviewQuery = { window: 'all', queue: 'all' } as const;

  it('shares one upstream fetch between requests within the cache window', async () => {
    const { dota, calls } = service();
    await Promise.all([dota.overview('u', overviewQuery), dota.overview('u', overviewQuery)]);
    await dota.listMatches('u', { queue: 'all', result: 'all', page: 1, pageSize: 25 });
    expect(calls.filter((c) => c.path === `/players/${ACCOUNT}/matches`)).toHaveLength(1);
  });

  it('does not cache a failed fetch', async () => {
    let fail = true;
    const { dota } = service({ [`/players/${ACCOUNT}/matches`]: () => (fail ? json({}, 400) : json([rawSummary()])) });
    await expect(dota.overview('u', overviewQuery)).rejects.toBeInstanceOf(UpstreamError);
    fail = false;
    await expect(dota.overview('u', overviewQuery)).resolves.toBeDefined();
  });

  it('returns an empty overview when OpenDota has no data for the account', async () => {
    const { dota } = service({ [`/players/${ACCOUNT}`]: () => json({ error: 'Not Found' }, 404), [`/players/${ACCOUNT}/matches`]: () => json([]) });
    const { dto } = await dota.overview('u', overviewQuery);
    expect(dto.matchesTotal).toBe(0);
    expect(dto.totals.winRate).toBeNull();
    expect(dto.player).toMatchObject({ accountId: ACCOUNT, personaName: null, rankTier: null });
  });

  it('reports a SteamID with no Dota account as not found', async () => {
    const { dota, calls } = service(undefined, '76561190000000001');
    await expect(dota.overview('u', overviewQuery)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls).toEqual([]);
  });

  it('filters and paginates match records', async () => {
    const history = [rawSummary({ match_id: 1, hero_id: 1, player_slot: 0 }), rawSummary({ match_id: 2, hero_id: 2, player_slot: 128 }), rawSummary({ match_id: 3, hero_id: 1, player_slot: 128 })];
    const { dota } = service({ [`/players/${ACCOUNT}/matches`]: () => json(history) });
    const heroOne = await dota.listMatches('u', { queue: 'all', result: 'all', heroId: 1, page: 1, pageSize: 25 });
    expect(heroOne.dto.items.map((m) => m.matchId)).toEqual([1, 3]);
    const losses = await dota.listMatches('u', { queue: 'all', result: 'loss', page: 2, pageSize: 1 });
    expect(losses.total).toBe(2);
    expect(losses.dto.items.map((m) => m.matchId)).toEqual([3]);
  });

  it('marks the player and adds the analysis to a match they played', async () => {
    const { dota } = service();
    const dto = await dota.matchDetail('u', 10);
    expect(dto.players[0]).toMatchObject({ isYou: true, name: 'Me', items: [{ id: 1, name: 'Blink Dagger' }] });
    expect(dto.performance?.won).toBe(true);
  });

  it('shows a match the player was not in without an analysis or a history fetch', async () => {
    const { dota, calls } = service({ '/matches/10': () => json(rawMatch({ players: [rawPlayer({ account_id: 123 })] })) });
    const dto = await dota.matchDetail('u', 10);
    expect(dto.performance).toBeNull();
    expect(dto.players[0]!.isYou).toBe(false);
    expect(calls.some((c) => c.path.endsWith('/matches') && c.path.startsWith('/players'))).toBe(false);
  });

  it('answers not found for an unknown match', async () => {
    const { dota } = service();
    await expect(dota.matchDetail('u', 404)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refetches the history after a refresh and the match after a parse request', async () => {
    const { dota, calls } = service({ [`/players/${ACCOUNT}/refresh`]: () => json({ length: 1 }), '/request/10': () => json({ job: { jobId: 1 } }) });
    await dota.overview('u', overviewQuery);
    await dota.refresh('u');
    await dota.overview('u', overviewQuery);
    expect(calls.filter((c) => c.path === `/players/${ACCOUNT}/matches`)).toHaveLength(2);
    expect(calls.find((c) => c.path.endsWith('/refresh'))!.method).toBe('POST');

    await dota.matchDetail('u', 10);
    await dota.requestParse('u', 10);
    await dota.matchDetail('u', 10);
    expect(calls.filter((c) => c.path === '/matches/10')).toHaveLength(2);
    expect(calls.find((c) => c.path === '/request/10')!.method).toBe('POST');
  });

  it('checks an unparsed match again after a few minutes but keeps a parsed one', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    try {
      const { dota, calls } = service({ '/matches/20': () => json(rawMatch({ match_id: 20, od_data: { has_parsed: false } })) });
      await dota.matchDetail('u', 20);
      await dota.matchDetail('u', 10);
      vi.advanceTimersByTime(6 * 60 * 1000);
      await dota.matchDetail('u', 20);
      await dota.matchDetail('u', 10);
      expect(calls.filter((c) => c.path === '/matches/20')).toHaveLength(2);
      expect(calls.filter((c) => c.path === '/matches/10')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
