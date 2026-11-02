import { describe, expect, it } from 'vitest';
import {
  analyzeDotaHistory, analyzeMatchPerformance, kdaRatio, matchesQueue, matchWon, steamIdToAccountId,
  type DotaItemInfo, type DotaMatchData, type DotaMatchPlayerData, type DotaMatchSummary,
} from '../src';

const DAY = 86_400;
const ME = 1000;

let nextId = 1;
const summary = (over: Partial<DotaMatchSummary> = {}): DotaMatchSummary => ({
  matchId: nextId++,
  startTime: 1_700_000_000,
  durationSeconds: 30 * 60,
  gameMode: 22,
  lobbyType: 7,
  heroId: 1,
  playerSlot: 0,
  radiantWin: true,
  kills: 5,
  deaths: 5,
  assists: 5,
  gpm: 500,
  xpm: 600,
  heroDamage: 20_000,
  towerDamage: 1000,
  heroHealing: 0,
  lastHits: 150,
  partySize: 1,
  ...over,
});
/** `n` matches, newest first, whose results follow `pattern` repeated. */
const series = (n: number, pattern: boolean[], over: Partial<DotaMatchSummary> = {}) =>
  Array.from({ length: n }, (_, i) => summary({ startTime: 1_700_000_000 - i * DAY, radiantWin: pattern[i % pattern.length]!, ...over }));

const player = (over: Partial<DotaMatchPlayerData> = {}): DotaMatchPlayerData => ({
  accountId: null,
  personaName: null,
  rankTier: null,
  heroId: 2,
  playerSlot: 1,
  level: 20,
  kills: 2,
  deaths: 4,
  assists: 3,
  lastHits: 100,
  denies: 5,
  gpm: 400,
  xpm: 400,
  heroDamage: 10_000,
  towerDamage: 500,
  heroHealing: 0,
  netWorth: 10_000,
  itemIds: [],
  neutralItemId: null,
  benchmarks: null,
  laneEfficiencyPct: null,
  observersPlaced: null,
  sentriesPlaced: null,
  stunSeconds: null,
  campsStacked: null,
  runePickups: null,
  firstBloodClaimed: null,
  purchaseLog: [],
  goldTimeline: [],
  xpTimeline: [],
  lastHitTimeline: [],
  ...over,
});

const match = (me: Partial<DotaMatchPlayerData> = {}, over: Partial<DotaMatchData> = {}): DotaMatchData => ({
  matchId: 999_999,
  startTime: 1_700_000_000,
  durationSeconds: 30 * 60,
  gameMode: 22,
  lobbyType: 7,
  radiantWin: true,
  radiantScore: 20,
  direScore: 10,
  parsed: true,
  radiantGoldAdvantage: [],
  radiantXpAdvantage: [],
  players: [
    player({ accountId: ME, heroId: 1, playerSlot: 0, ...me }),
    player({ playerSlot: 1 }),
    player({ playerSlot: 2 }),
    player({ playerSlot: 128 }),
    player({ playerSlot: 129 }),
  ],
  ...over,
});

const noItems = new Map<string, DotaItemInfo>();

describe('steamIdToAccountId', () => {
  it('converts a real SteamID64', () => {
    expect(steamIdToAccountId('76561198047544485')).toBe(87278757);
  });

  it('rejects ids below the individual-account range', () => {
    expect(steamIdToAccountId('76561190000000001')).toBeNull();
  });
});

describe('results', () => {
  it('reads the winner from the player slot and side', () => {
    expect(matchWon({ playerSlot: 0, radiantWin: true })).toBe(true);
    expect(matchWon({ playerSlot: 128, radiantWin: true })).toBe(false);
    expect(matchWon({ playerSlot: 128, radiantWin: false })).toBe(true);
    expect(matchWon({ playerSlot: 0, radiantWin: null })).toBeNull();
  });

  it('computes KDA without dividing by zero deaths', () => {
    expect(kdaRatio(4, 0, 6)).toBe(10);
    expect(kdaRatio(4, 2, 6)).toBe(5);
  });

  it('keeps turbo out of ranked and unranked', () => {
    const turbo = { gameMode: 23, lobbyType: 0 };
    const ranked = { gameMode: 22, lobbyType: 7 };
    const normal = { gameMode: 22, lobbyType: 0 };
    expect(matchesQueue(turbo, 'turbo')).toBe(true);
    expect(matchesQueue(turbo, 'unranked')).toBe(false);
    expect(matchesQueue(ranked, 'ranked')).toBe(true);
    expect(matchesQueue(normal, 'ranked')).toBe(false);
    expect(matchesQueue(normal, 'unranked')).toBe(true);
  });
});

describe('analyzeDotaHistory', () => {
  it('returns unknown values, not zeros, for an empty history', () => {
    const a = analyzeDotaHistory([]);
    expect(a.totals.games).toBe(0);
    expect(a.totals.winRate).toBeNull();
    expect(a.totals.kda).toBeNull();
    expect(a.totals.avgGpm).toBeNull();
    expect(a.insights).toEqual([]);
  });

  it('excludes unfinished matches from the win rate but still counts them as played', () => {
    const a = analyzeDotaHistory([summary({ radiantWin: true }), summary({ radiantWin: false }), summary({ radiantWin: null })]);
    expect(a.totals.games).toBe(3);
    expect(a.totals.wins).toBe(1);
    expect(a.totals.losses).toBe(1);
    expect(a.totals.winRate).toBe(50);
  });

  it('skips unknown stats in averages', () => {
    const a = analyzeDotaHistory([summary({ gpm: 400 }), summary({ gpm: null })]);
    expect(a.totals.avgGpm).toBe(400);
  });

  it('finds the current and longest streaks regardless of input order', () => {
    const results = [true, true, true, false, false, true]; // newest first
    const input = results.map((won, i) => summary({ startTime: 1_700_000_000 - i * DAY, radiantWin: won }));
    const a = analyzeDotaHistory([...input].reverse());
    expect(a.streaks.current).toEqual({ result: 'win', count: 3 });
    expect(a.streaks.longestWin).toBe(3);
    expect(a.streaks.longestLoss).toBe(2);
  });

  it('computes the rolling win rate only over full windows', () => {
    expect(analyzeDotaHistory(series(19, [true])).rollingWinRate).toEqual([]);
    const a = analyzeDotaHistory(series(21, [true]));
    expect(a.rollingWinRate).toHaveLength(2);
    expect(a.rollingWinRate[0]!.winRate).toBe(100);
  });

  it('slides the rolling window off old results', () => {
    const newestLoss = [summary({ startTime: 1_700_000_000 + DAY, radiantWin: false }), ...series(20, [true])];
    expect(analyzeDotaHistory(newestLoss).rollingWinRate.at(-1)!.winRate).toBe(95);
  });

  it('groups by hero, most played first', () => {
    const a = analyzeDotaHistory([summary({ heroId: 7 }), summary({ heroId: 9 }), summary({ heroId: 9 })]);
    expect(a.heroes.map((h) => [h.heroId, h.games])).toEqual([[9, 2], [7, 1]]);
  });

  it('leaves unknown party sizes out of the solo and party split', () => {
    const a = analyzeDotaHistory([summary({ partySize: 1 }), summary({ partySize: 3 }), summary({ partySize: null })]);
    expect(a.byParty.solo.games).toBe(1);
    expect(a.byParty.party.games).toBe(1);
  });

  it('does not draw conclusions from a small sample', () => {
    const a = analyzeDotaHistory(series(9, [true], { heroId: 3 }), () => 'Axe');
    expect(a.insights.find((i) => i.code === 'bestHero')).toBeUndefined();
  });

  it('names the best hero once the sample is large enough', () => {
    const a = analyzeDotaHistory(series(10, [true], { heroId: 3 }), () => 'Axe');
    expect(a.insights.find((i) => i.code === 'bestHero')?.values).toEqual({ hero: 'Axe', winRate: 100, games: 10 });
  });

  it('flags a change in recent form', () => {
    const recentWins = series(20, [true]);
    const olderLosses = Array.from({ length: 40 }, (_, i) => summary({ startTime: 1_600_000_000 - i * DAY, radiantWin: false }));
    const form = analyzeDotaHistory([...recentWins, ...olderLosses]).insights.find((i) => i.code === 'formUp');
    expect(form?.values).toMatchObject({ recent: 100, n: 20 });
  });
});

describe('analyzeMatchPerformance', () => {
  it('returns null when the player is not in the match', () => {
    expect(analyzeMatchPerformance(match(), 42, [], noItems)).toBeNull();
  });

  it('calculates team shares and ranks within the player\'s own team only', () => {
    // Dire players have higher damage, which must not affect the Radiant player's rank.
    const m = match({ heroDamage: 20_000, kills: 5, assists: 3 });
    m.players[3] = player({ playerSlot: 128, heroDamage: 90_000 });
    const p = analyzeMatchPerformance(m, ME, [], noItems)!;
    expect(p.teamRank.heroDamage).toBe(1);
    expect(p.teamShare.heroDamage).toBe(50); // 20k of 20k + 10k + 10k
    expect(p.teamShare.killParticipation).toBeCloseTo((8 / 9) * 100, 1); // team kills 5 + 2 + 2
  });

  it('reports the win from the player\'s perspective', () => {
    expect(analyzeMatchPerformance(match({ playerSlot: 128 }), ME, [], noItems)!.won).toBe(false);
  });

  it('compares turbo only with turbo and leaves out this match', () => {
    const history = [
      ...Array.from({ length: 5 }, () => summary({ heroId: 1, gameMode: 22, gpm: 500 })),
      ...Array.from({ length: 5 }, () => summary({ heroId: 1, gameMode: 23, gpm: 1000 })),
      summary({ matchId: 999_999, heroId: 1, gameMode: 22, gpm: 9000 }),
    ];
    const normal = analyzeMatchPerformance(match({ gpm: 600 }), ME, history, noItems)!;
    expect(normal.comparison.find((c) => c.metric === 'gpm')!.heroAverage).toBe(500);
    expect(normal.heroGames).toBe(5);
    const turbo = analyzeMatchPerformance(match({ gpm: 600 }, { gameMode: 23 }), ME, history, noItems)!;
    expect(turbo.comparison.find((c) => c.metric === 'gpm')!.heroAverage).toBe(1000);
  });

  it('withholds averages below the minimum sample', () => {
    const p = analyzeMatchPerformance(match(), ME, [summary({ heroId: 1 })], noItems)!;
    expect(p.comparison.find((c) => c.metric === 'gpm')!.heroAverage).toBeNull();
    expect(p.highlights.find((h) => h.code === 'aboveHeroAverage')).toBeUndefined();
  });

  it('detects a comeback from the team that won', () => {
    const p = analyzeMatchPerformance(match({}, { radiantWin: true, radiantGoldAdvantage: [0, -9000, 2000] }), ME, [], noItems)!;
    expect(p.highlights.find((h) => h.code === 'comeback')?.values).toEqual({ gold: 9000 });
  });

  it('detects a thrown lead from the team that lost', () => {
    const p = analyzeMatchPerformance(match({ playerSlot: 128 }, { radiantWin: true, radiantGoldAdvantage: [0, -9000, 2000] }), ME, [], noItems)!;
    expect(p.highlights.find((h) => h.code === 'thrownLead')?.values).toEqual({ gold: 9000 });
  });

  it('does not call a game a comeback when the winner was never far behind', () => {
    const p = analyzeMatchPerformance(match({}, { radiantWin: true, radiantGoldAdvantage: [0, 500, 22_000] }), ME, [], noItems)!;
    expect(p.highlights.find((h) => h.code === 'comeback')).toBeUndefined();
    expect(p.highlights.find((h) => h.code === 'thrownLead')).toBeUndefined();
  });

  it('lists only the first purchase of major items, in order', () => {
    const items = new Map<string, DotaItemInfo>([
      ['blink', { id: 1, key: 'blink', name: 'Blink Dagger', imageUrl: null, cost: 2250 }],
      ['tango', { id: 44, key: 'tango', name: 'Tango', imageUrl: null, cost: 90 }],
      ['recipe_x', { id: 50, key: 'recipe_x', name: 'Recipe', imageUrl: null, cost: 2000 }],
      ['bkb', { id: 116, key: 'bkb', name: 'Black King Bar', imageUrl: null, cost: 4050 }],
    ]);
    const purchaseLog = [
      { time: 1500, key: 'bkb' },
      { time: -60, key: 'tango' },
      { time: 900, key: 'blink' },
      { time: 1000, key: 'recipe_x' },
      { time: 1800, key: 'blink' },
    ];
    const p = analyzeMatchPerformance(match({ purchaseLog }), ME, [], items)!;
    expect(p.itemTimings.map((i) => [i.item.name, i.timeSeconds])).toEqual([['Blink Dagger', 900], ['Black King Bar', 1500]]);
  });

  it('reads benchmarks as percentiles', () => {
    const benchmarks = { gold_per_min: { raw: 700, pct: 0.95 }, hero_damage_per_min: { raw: 100, pct: 0.05 }, tower_damage: { raw: 1, pct: 0.99 }, xp_per_min: { raw: 1, pct: null } };
    const p = analyzeMatchPerformance(match({ benchmarks }), ME, [], noItems)!;
    expect(p.benchmarks.map((b) => b.key)).toEqual(['gold_per_min', 'hero_damage_per_min']);
    expect(p.highlights.find((h) => h.code === 'topBenchmark')?.values).toEqual({ metric: 'gold_per_min', percentile: 95 });
    expect(p.highlights.find((h) => h.code === 'lowBenchmark')?.values).toEqual({ metric: 'hero_damage_per_min', percentile: 5 });
  });
});
