/**
 * Dota 2 match data, API contracts and analysis. Calculations are pure functions
 * so they stay unit-testable and independent of the upstream data source.
 */
import { round } from './analytics';

const STEAM_ID64_BASE = 76561197960265728n;
const MAX_ACCOUNT_ID = 4294967295n;

/** Dota account id (32-bit SteamID). null when the SteamID64 is outside the individual-account range. */
export function steamIdToAccountId(steamId: string): number | null {
  const id = BigInt(steamId) - STEAM_ID64_BASE;
  return id > 0n && id <= MAX_ACCOUNT_ID ? Number(id) : null;
}

export const DOTA_TURBO_MODE = 23;
/** 5 and 6 are legacy ranked team / solo lobbies. */
const RANKED_LOBBIES = new Set([5, 6, 7]);

export const isRadiantSlot = (playerSlot: number): boolean => playerSlot < 128;

// ---------- Normalized upstream data ----------

export interface DotaMatchSummary {
  matchId: number;
  /** Unix seconds. */
  startTime: number;
  durationSeconds: number;
  gameMode: number;
  lobbyType: number;
  heroId: number;
  playerSlot: number;
  /** null when the match was not completed. */
  radiantWin: boolean | null;
  kills: number;
  deaths: number;
  assists: number;
  gpm: number | null;
  xpm: number | null;
  heroDamage: number | null;
  towerDamage: number | null;
  heroHealing: number | null;
  lastHits: number | null;
  /** null when OpenDota does not know the party size. */
  partySize: number | null;
}

export interface DotaBenchmark {
  raw: number | null;
  /** 0–1 percentile among recent games on the same hero. */
  pct: number | null;
}

export interface DotaMatchPlayerData {
  /** null for players who hide their match data. */
  accountId: number | null;
  personaName: string | null;
  rankTier: number | null;
  heroId: number;
  playerSlot: number;
  level: number | null;
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number | null;
  denies: number | null;
  gpm: number | null;
  xpm: number | null;
  heroDamage: number | null;
  towerDamage: number | null;
  heroHealing: number | null;
  netWorth: number | null;
  itemIds: number[];
  neutralItemId: number | null;
  benchmarks: Record<string, DotaBenchmark> | null;
  // The fields below need a parsed replay: they are null or empty otherwise.
  laneEfficiencyPct: number | null;
  observersPlaced: number | null;
  sentriesPlaced: number | null;
  stunSeconds: number | null;
  campsStacked: number | null;
  runePickups: number | null;
  firstBloodClaimed: boolean | null;
  purchaseLog: { time: number; key: string }[];
  /** Cumulative values per minute. */
  goldTimeline: number[];
  xpTimeline: number[];
  lastHitTimeline: number[];
}

export interface DotaMatchData {
  matchId: number;
  startTime: number;
  durationSeconds: number;
  gameMode: number;
  lobbyType: number;
  radiantWin: boolean | null;
  radiantScore: number | null;
  direScore: number | null;
  /** Replay parsed: timelines, purchases and vision data are available. */
  parsed: boolean;
  /** Radiant gold / XP lead per minute (empty when not parsed). */
  radiantGoldAdvantage: number[];
  radiantXpAdvantage: number[];
  players: DotaMatchPlayerData[];
}

export interface DotaItemInfo {
  id: number;
  key: string;
  name: string;
  imageUrl: string | null;
  cost: number | null;
}

// ---------- API contracts ----------

export interface DotaHeroRef {
  id: number;
  name: string;
  iconUrl: string | null;
  imageUrl: string | null;
}

export interface DotaItemRef {
  id: number;
  name: string;
  imageUrl: string | null;
}

export interface DotaPlayerDto {
  accountId: number;
  personaName: string | null;
  /** Medal tens digit (1 Herald … 8 Immortal) and stars units digit. */
  rankTier: number | null;
  leaderboardRank: number | null;
}

/** A rule-based observation. `code` selects the localized message; `values` fill it in. */
export interface DotaInsight {
  code: DotaInsightCode;
  tone: 'good' | 'bad' | 'neutral';
  values: Record<string, string | number>;
}

export const DOTA_INSIGHT_CODES = [
  'hotStreak', 'coldStreak', 'formUp', 'formDown', 'bestHero', 'worstHero', 'sideBias', 'durationBias', 'partyBias', 'narrowPool',
  'perfectGame', 'firstBlood', 'topDamage', 'topNetWorth', 'mostDeaths', 'highParticipation', 'lowParticipation',
  'aboveHeroAverage', 'belowHeroAverage', 'topBenchmark', 'lowBenchmark', 'comeback', 'thrownLead',
] as const;
export type DotaInsightCode = (typeof DOTA_INSIGHT_CODES)[number];

export interface DotaWinBucket {
  games: number;
  wins: number;
  /** 0–100, null when no game in the bucket has a result. */
  winRate: number | null;
}

export interface DotaHeroStats extends DotaWinBucket {
  heroId: number;
  kda: number | null;
  avgGpm: number | null;
  avgXpm: number | null;
  lastPlayedAt: string | null;
}

export const DOTA_DURATION_BUCKETS = ['under25', 'from25to35', 'from35to45', 'over45'] as const;
export type DotaDurationBucket = (typeof DOTA_DURATION_BUCKETS)[number];

export interface DotaHistoryAnalysis {
  totals: DotaWinBucket & {
    losses: number;
    kda: number | null;
    avgKills: number | null;
    avgDeaths: number | null;
    avgAssists: number | null;
    avgDurationSeconds: number | null;
    totalDurationSeconds: number;
    avgGpm: number | null;
    avgXpm: number | null;
    avgHeroDamage: number | null;
    avgLastHits: number | null;
    firstMatchAt: string | null;
    lastMatchAt: string | null;
  };
  streaks: { current: { result: 'win' | 'loss' | null; count: number }; longestWin: number; longestLoss: number };
  /** Most played first. */
  heroes: DotaHeroStats[];
  byGameMode: (DotaWinBucket & { gameMode: number })[];
  bySide: { radiant: DotaWinBucket; dire: DotaWinBucket };
  byDuration: (DotaWinBucket & { bucket: DotaDurationBucket })[];
  byParty: { solo: DotaWinBucket; party: DotaWinBucket };
  monthly: (DotaWinBucket & { month: string })[];
  /** Win rate over the previous 20 decided matches, oldest first. */
  rollingWinRate: { at: string; winRate: number }[];
  /** Newest first, at most 20. */
  recentForm: { matchId: number; won: boolean }[];
  insights: DotaInsight[];
}

export interface DotaOverviewDto extends DotaHistoryAnalysis {
  player: DotaPlayerDto;
  heroRefs: DotaHeroRef[];
  /** Matches in the account's history before the window and queue filters. */
  matchesTotal: number;
  /** History is longer than the number of matches fetched. */
  truncated: boolean;
}

export interface DotaMatchListItemDto {
  matchId: number;
  startTime: string;
  durationSeconds: number;
  gameMode: number;
  ranked: boolean;
  hero: DotaHeroRef;
  won: boolean | null;
  isRadiant: boolean;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  gpm: number | null;
  xpm: number | null;
  heroDamage: number | null;
  lastHits: number | null;
}

export interface DotaMatchListDto {
  items: DotaMatchListItemDto[];
  /** Every hero in the account's history, for the hero filter. */
  heroes: DotaHeroRef[];
}

export interface DotaMatchPlayerDto {
  accountId: number | null;
  isYou: boolean;
  name: string | null;
  rankTier: number | null;
  hero: DotaHeroRef;
  isRadiant: boolean;
  level: number | null;
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number | null;
  denies: number | null;
  gpm: number | null;
  xpm: number | null;
  heroDamage: number | null;
  towerDamage: number | null;
  heroHealing: number | null;
  netWorth: number | null;
  items: DotaItemRef[];
  neutralItem: DotaItemRef | null;
}

export const DOTA_COMPARISON_METRICS = ['kda', 'gpm', 'xpm', 'lastHitsPerMinute', 'heroDamagePerMinute'] as const;
export type DotaComparisonMetric = (typeof DOTA_COMPARISON_METRICS)[number];

export interface DotaPerformanceAnalysis {
  won: boolean | null;
  isRadiant: boolean;
  kda: number;
  /** Percentages of the player's team (0–100). null when the team total is unknown or zero. */
  teamShare: { killParticipation: number | null; heroDamage: number | null; towerDamage: number | null; netWorth: number | null };
  /** Position within the team, 1 = highest. */
  teamRank: { gpm: number | null; xpm: number | null; heroDamage: number | null; lastHits: number | null; netWorth: number | null };
  /** Percentile (0–100) among recent games on the same hero, from OpenDota. */
  benchmarks: { key: string; value: number | null; percentile: number }[];
  /** Compared with the player's own similar games (turbo and non-turbo are never mixed). */
  comparison: { metric: DotaComparisonMetric; value: number | null; heroAverage: number | null; overallAverage: number | null }[];
  heroGames: number;
  overallGames: number;
  detail: {
    laneEfficiencyPct: number | null;
    observersPlaced: number | null;
    sentriesPlaced: number | null;
    stunSeconds: number | null;
    campsStacked: number | null;
    runePickups: number | null;
  };
  /** First purchase of each major item, in order. Empty when the replay is not parsed. */
  itemTimings: { item: DotaItemRef; timeSeconds: number }[];
  goldTimeline: number[];
  xpTimeline: number[];
  lastHitTimeline: number[];
  highlights: DotaInsight[];
}

export interface DotaMatchDetailDto {
  matchId: number;
  startTime: string;
  durationSeconds: number;
  gameMode: number;
  ranked: boolean;
  radiantWin: boolean | null;
  radiantScore: number | null;
  direScore: number | null;
  parsed: boolean;
  radiantGoldAdvantage: number[];
  radiantXpAdvantage: number[];
  players: DotaMatchPlayerDto[];
  /** null when the signed-in player did not take part in this match. */
  performance: DotaPerformanceAnalysis | null;
}

export interface DotaParseRequestDto {
  requested: true;
}

// ---------- Filters ----------

export type DotaQueue = 'all' | 'ranked' | 'unranked' | 'turbo';

export const matchesQueue = (m: Pick<DotaMatchSummary, 'gameMode' | 'lobbyType'>, queue: DotaQueue): boolean => {
  switch (queue) {
    case 'all': return true;
    case 'ranked': return RANKED_LOBBIES.has(m.lobbyType);
    case 'turbo': return m.gameMode === DOTA_TURBO_MODE;
    case 'unranked': return !RANKED_LOBBIES.has(m.lobbyType) && m.gameMode !== DOTA_TURBO_MODE;
  }
};

export const isRankedLobby = (lobbyType: number): boolean => RANKED_LOBBIES.has(lobbyType);

// ---------- Calculations ----------

export function matchWon(m: Pick<DotaMatchSummary, 'playerSlot' | 'radiantWin'>): boolean | null {
  return m.radiantWin === null ? null : m.radiantWin === isRadiantSlot(m.playerSlot);
}

export const kdaRatio = (kills: number, deaths: number, assists: number): number => round((kills + assists) / Math.max(1, deaths), 2);

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();

function average(values: (number | null)[], digits = 1): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? round(known.reduce((a, b) => a + b, 0) / known.length, digits) : null;
}

function winBucket(matches: DotaMatchSummary[]): DotaWinBucket {
  let wins = 0;
  let decided = 0;
  for (const m of matches) {
    const won = matchWon(m);
    if (won === null) continue;
    decided += 1;
    if (won) wins += 1;
  }
  return { games: matches.length, wins, winRate: decided ? round((wins / decided) * 100, 1) : null };
}

function groupBy<K>(matches: DotaMatchSummary[], key: (m: DotaMatchSummary) => K): Map<K, DotaMatchSummary[]> {
  const groups = new Map<K, DotaMatchSummary[]>();
  for (const m of matches) {
    const k = key(m);
    const group = groups.get(k);
    if (group) group.push(m);
    else groups.set(k, [m]);
  }
  return groups;
}

function durationBucket(seconds: number): DotaDurationBucket {
  if (seconds < 25 * 60) return 'under25';
  if (seconds < 35 * 60) return 'from25to35';
  if (seconds < 45 * 60) return 'from35to45';
  return 'over45';
}

function aggregateKda(matches: DotaMatchSummary[]): number | null {
  if (matches.length === 0) return null;
  const sum = (pick: (m: DotaMatchSummary) => number) => matches.reduce((a, m) => a + pick(m), 0);
  return kdaRatio(sum((m) => m.kills), sum((m) => m.deaths), sum((m) => m.assists));
}

const ROLLING_WINDOW = 20;
const ROLLING_MAX_POINTS = 200;
const FORM_SIZE = 20;

// Sample sizes below which a difference is more likely noise than a pattern.
const MIN_HERO_GAMES = 10;
const MIN_FORM_HISTORY = 40;
const MIN_SPLIT_GAMES = 20;
const MIN_DURATION_GAMES = 15;
const MIN_POOL_GAMES = 30;
const MIN_STREAK = 4;
const NOTABLE_GAP = 8;
const NOTABLE_DURATION_GAP = 12;

function historyInsights(
  a: Omit<DotaHistoryAnalysis, 'insights'>,
  heroName: (heroId: number) => string,
): DotaInsight[] {
  const insights: DotaInsight[] = [];
  const { totals, streaks, heroes, bySide, byParty, byDuration, recentForm } = a;

  if (streaks.current.count >= MIN_STREAK) {
    insights.push({ code: streaks.current.result === 'win' ? 'hotStreak' : 'coldStreak', tone: streaks.current.result === 'win' ? 'good' : 'bad', values: { n: streaks.current.count } });
  }
  if (totals.games >= MIN_FORM_HISTORY && totals.winRate !== null && recentForm.length === FORM_SIZE) {
    const recent = round((recentForm.filter((r) => r.won).length / FORM_SIZE) * 100, 1);
    const gap = round(Math.abs(recent - totals.winRate), 1);
    if (gap >= NOTABLE_GAP) {
      const up = recent > totals.winRate;
      insights.push({ code: up ? 'formUp' : 'formDown', tone: up ? 'good' : 'bad', values: { recent, overall: totals.winRate, n: FORM_SIZE } });
    }
  }
  const qualified = heroes.filter((h) => h.games >= MIN_HERO_GAMES && h.winRate !== null);
  if (qualified.length > 0) {
    const best = qualified.reduce((x, y) => (y.winRate! > x.winRate! ? y : x));
    const worst = qualified.reduce((x, y) => (y.winRate! < x.winRate! ? y : x));
    if (best.winRate! >= 55) insights.push({ code: 'bestHero', tone: 'good', values: { hero: heroName(best.heroId), winRate: best.winRate!, games: best.games } });
    if (worst.winRate! <= 45) insights.push({ code: 'worstHero', tone: 'bad', values: { hero: heroName(worst.heroId), winRate: worst.winRate!, games: worst.games } });
  }
  if (bySide.radiant.games >= MIN_SPLIT_GAMES && bySide.dire.games >= MIN_SPLIT_GAMES && bySide.radiant.winRate !== null && bySide.dire.winRate !== null) {
    if (Math.abs(bySide.radiant.winRate - bySide.dire.winRate) >= NOTABLE_GAP) {
      insights.push({ code: 'sideBias', tone: 'neutral', values: { radiant: bySide.radiant.winRate, dire: bySide.dire.winRate } });
    }
  }
  if (byParty.solo.games >= MIN_SPLIT_GAMES && byParty.party.games >= MIN_SPLIT_GAMES && byParty.solo.winRate !== null && byParty.party.winRate !== null) {
    if (Math.abs(byParty.solo.winRate - byParty.party.winRate) >= NOTABLE_GAP) {
      insights.push({ code: 'partyBias', tone: 'neutral', values: { solo: byParty.solo.winRate, party: byParty.party.winRate } });
    }
  }
  const durations = byDuration.filter((d) => d.games >= MIN_DURATION_GAMES && d.winRate !== null);
  if (durations.length >= 2) {
    const best = durations.reduce((x, y) => (y.winRate! > x.winRate! ? y : x));
    const worst = durations.reduce((x, y) => (y.winRate! < x.winRate! ? y : x));
    if (best.winRate! - worst.winRate! >= NOTABLE_DURATION_GAP) {
      insights.push({ code: 'durationBias', tone: 'neutral', values: { best: best.bucket, bestRate: best.winRate!, worst: worst.bucket, worstRate: worst.winRate! } });
    }
  }
  if (totals.games >= MIN_POOL_GAMES) {
    const top3 = heroes.slice(0, 3).reduce((n, h) => n + h.games, 0);
    const share = round((top3 / totals.games) * 100, 0);
    if (share >= 50) insights.push({ code: 'narrowPool', tone: 'neutral', values: { share } });
  }
  return insights;
}

/** Aggregates a player's match history. `matches` may be in any order. */
export function analyzeDotaHistory(input: DotaMatchSummary[], heroName: (heroId: number) => string = String): DotaHistoryAnalysis {
  const matches = [...input].sort((a, b) => b.startTime - a.startTime);
  const decided = matches.filter((m) => matchWon(m) !== null);
  const bucket = winBucket(matches);

  // Streaks: newest first, unfinished matches are ignored.
  let longestWin = 0;
  let longestLoss = 0;
  let run = 0;
  let runWon: boolean | null = null;
  let current: DotaHistoryAnalysis['streaks']['current'] = { result: null, count: 0 };
  let currentOpen = true;
  for (const m of decided) {
    const won = matchWon(m)!;
    if (won === runWon) run += 1;
    else {
      if (runWon !== null) currentOpen = false;
      run = 1;
      runWon = won;
    }
    if (currentOpen) current = { result: won ? 'win' : 'loss', count: run };
    if (won) longestWin = Math.max(longestWin, run);
    else longestLoss = Math.max(longestLoss, run);
  }

  const heroes: DotaHeroStats[] = [...groupBy(matches, (m) => m.heroId)]
    .map(([heroId, group]) => ({
      heroId,
      ...winBucket(group),
      kda: aggregateKda(group),
      avgGpm: average(group.map((m) => m.gpm), 0),
      avgXpm: average(group.map((m) => m.xpm), 0),
      lastPlayedAt: iso(group[0]!.startTime),
    }))
    .sort((a, b) => b.games - a.games || a.heroId - b.heroId);

  const chronological = [...decided].reverse();
  const rolling: DotaHistoryAnalysis['rollingWinRate'] = [];
  let wins = 0;
  chronological.forEach((m, i) => {
    if (matchWon(m)) wins += 1;
    if (i >= ROLLING_WINDOW && matchWon(chronological[i - ROLLING_WINDOW]!)) wins -= 1;
    if (i >= ROLLING_WINDOW - 1) rolling.push({ at: iso(m.startTime), winRate: round((wins / ROLLING_WINDOW) * 100, 1) });
  });

  const totalDurationSeconds = matches.reduce((a, m) => a + m.durationSeconds, 0);
  const partial: Omit<DotaHistoryAnalysis, 'insights'> = {
    totals: {
      ...bucket,
      losses: decided.length - bucket.wins,
      kda: aggregateKda(matches),
      avgKills: average(matches.map((m) => m.kills)),
      avgDeaths: average(matches.map((m) => m.deaths)),
      avgAssists: average(matches.map((m) => m.assists)),
      avgDurationSeconds: average(matches.map((m) => m.durationSeconds), 0),
      totalDurationSeconds,
      avgGpm: average(matches.map((m) => m.gpm), 0),
      avgXpm: average(matches.map((m) => m.xpm), 0),
      avgHeroDamage: average(matches.map((m) => m.heroDamage), 0),
      avgLastHits: average(matches.map((m) => m.lastHits), 0),
      firstMatchAt: matches.length ? iso(matches.at(-1)!.startTime) : null,
      lastMatchAt: matches.length ? iso(matches[0]!.startTime) : null,
    },
    streaks: { current, longestWin, longestLoss },
    heroes,
    byGameMode: [...groupBy(matches, (m) => m.gameMode)]
      .map(([gameMode, group]) => ({ gameMode, ...winBucket(group) }))
      .sort((a, b) => b.games - a.games),
    bySide: {
      radiant: winBucket(matches.filter((m) => isRadiantSlot(m.playerSlot))),
      dire: winBucket(matches.filter((m) => !isRadiantSlot(m.playerSlot))),
    },
    byDuration: DOTA_DURATION_BUCKETS.map((b) => ({ bucket: b, ...winBucket(matches.filter((m) => durationBucket(m.durationSeconds) === b)) })),
    byParty: {
      solo: winBucket(matches.filter((m) => m.partySize === 1)),
      party: winBucket(matches.filter((m) => m.partySize !== null && m.partySize > 1)),
    },
    monthly: [...groupBy(matches, (m) => iso(m.startTime).slice(0, 7))]
      .map(([month, group]) => ({ month, ...winBucket(group) }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    rollingWinRate: rolling.slice(-ROLLING_MAX_POINTS),
    recentForm: decided.slice(0, FORM_SIZE).map((m) => ({ matchId: m.matchId, won: matchWon(m)! })),
  };
  return { ...partial, insights: historyInsights(partial, heroName) };
}

// ---------- Single match ----------

function teamRank(players: DotaMatchPlayerData[], player: DotaMatchPlayerData, pick: (p: DotaMatchPlayerData) => number | null): number | null {
  const value = pick(player);
  if (value === null) return null;
  return 1 + players.filter((p) => (pick(p) ?? Number.NEGATIVE_INFINITY) > value).length;
}

function teamSharePct(players: DotaMatchPlayerData[], player: DotaMatchPlayerData, pick: (p: DotaMatchPlayerData) => number | null): number | null {
  const value = pick(player);
  const total = players.reduce((a, p) => a + (pick(p) ?? 0), 0);
  return value === null || total <= 0 ? null : round((value / total) * 100, 1);
}

function metricOf(metric: DotaComparisonMetric, m: Pick<DotaMatchSummary, 'kills' | 'deaths' | 'assists' | 'gpm' | 'xpm' | 'lastHits' | 'heroDamage' | 'durationSeconds'>): number | null {
  const minutes = m.durationSeconds / 60;
  switch (metric) {
    case 'kda': return kdaRatio(m.kills, m.deaths, m.assists);
    case 'gpm': return m.gpm;
    case 'xpm': return m.xpm;
    case 'lastHitsPerMinute': return m.lastHits === null || minutes <= 0 ? null : round(m.lastHits / minutes, 2);
    case 'heroDamagePerMinute': return m.heroDamage === null || minutes <= 0 ? null : round(m.heroDamage / minutes, 0);
  }
}

const MIN_COMPARISON_GAMES = 5;
const NOTABLE_ABOVE_AVERAGE = 0.15;
/** A gold lead this large that flips counts as a real comeback or thrown game. */
const NOTABLE_SWING_GOLD = 8000;
const MAJOR_ITEM_COST = 1000;
const IGNORED_BENCHMARK = 'tower_damage';

/**
 * Analyzes one player's game. `history` is the same player's match history;
 * averages use only games of the same type, since turbo inflates gold and XP.
 */
export function analyzeMatchPerformance(
  match: DotaMatchData,
  accountId: number,
  history: DotaMatchSummary[],
  items: Map<string, DotaItemInfo>,
): DotaPerformanceAnalysis | null {
  const player = match.players.find((p) => p.accountId === accountId);
  if (!player) return null;
  const isRadiant = isRadiantSlot(player.playerSlot);
  const team = match.players.filter((p) => isRadiantSlot(p.playerSlot) === isRadiant);
  const won = match.radiantWin === null ? null : match.radiantWin === isRadiant;
  const teamKills = team.reduce((a, p) => a + p.kills, 0);
  const durationSeconds = match.durationSeconds;

  const turbo = match.gameMode === DOTA_TURBO_MODE;
  const similar = history.filter((m) => m.matchId !== match.matchId && (m.gameMode === DOTA_TURBO_MODE) === turbo);
  const sameHero = similar.filter((m) => m.heroId === player.heroId);
  const comparison = DOTA_COMPARISON_METRICS.map((metric) => ({
    metric,
    value: metricOf(metric, { ...player, durationSeconds }),
    heroAverage: sameHero.length >= MIN_COMPARISON_GAMES ? average(sameHero.map((m) => metricOf(metric, m)), 2) : null,
    overallAverage: similar.length >= MIN_COMPARISON_GAMES ? average(similar.map((m) => metricOf(metric, m)), 2) : null,
  }));

  const benchmarks = Object.entries(player.benchmarks ?? {})
    .filter(([key, b]) => b.pct !== null && key !== IGNORED_BENCHMARK)
    .map(([key, b]) => ({ key, value: b.raw, percentile: round(b.pct! * 100, 0) }));

  const seen = new Set<string>();
  const itemTimings: DotaPerformanceAnalysis['itemTimings'] = [];
  for (const entry of [...player.purchaseLog].sort((a, b) => a.time - b.time)) {
    const item = items.get(entry.key);
    if (!item || (item.cost ?? 0) < MAJOR_ITEM_COST || entry.key.startsWith('recipe_') || seen.has(entry.key)) continue;
    seen.add(entry.key);
    itemTimings.push({ item: { id: item.id, name: item.name, imageUrl: item.imageUrl }, timeSeconds: entry.time });
  }

  const killParticipation = teamKills > 0 ? round((Math.min(player.kills + player.assists, teamKills) / teamKills) * 100, 1) : null;
  const rank = {
    gpm: teamRank(team, player, (p) => p.gpm),
    xpm: teamRank(team, player, (p) => p.xpm),
    heroDamage: teamRank(team, player, (p) => p.heroDamage),
    lastHits: teamRank(team, player, (p) => p.lastHits),
    netWorth: teamRank(team, player, (p) => p.netWorth),
  };

  const highlights: DotaInsight[] = [];
  if (won && player.deaths === 0) highlights.push({ code: 'perfectGame', tone: 'good', values: {} });
  if (player.firstBloodClaimed) highlights.push({ code: 'firstBlood', tone: 'good', values: {} });
  if (rank.heroDamage === 1) highlights.push({ code: 'topDamage', tone: 'good', values: { share: teamSharePct(team, player, (p) => p.heroDamage) ?? 0 } });
  if (rank.netWorth === 1) highlights.push({ code: 'topNetWorth', tone: 'good', values: { share: teamSharePct(team, player, (p) => p.netWorth) ?? 0 } });
  if (killParticipation !== null && teamKills >= 10) {
    if (killParticipation >= 70) highlights.push({ code: 'highParticipation', tone: 'good', values: { pct: killParticipation } });
    else if (killParticipation < 35) highlights.push({ code: 'lowParticipation', tone: 'bad', values: { pct: killParticipation } });
  }
  if (player.deaths >= 8 && team.every((p) => p.deaths <= player.deaths)) highlights.push({ code: 'mostDeaths', tone: 'bad', values: { n: player.deaths } });

  const gpmRow = comparison.find((c) => c.metric === 'gpm')!;
  if (gpmRow.value !== null && gpmRow.heroAverage) {
    const diff = (gpmRow.value - gpmRow.heroAverage) / gpmRow.heroAverage;
    if (Math.abs(diff) >= NOTABLE_ABOVE_AVERAGE) {
      highlights.push({ code: diff > 0 ? 'aboveHeroAverage' : 'belowHeroAverage', tone: diff > 0 ? 'good' : 'bad', values: { pct: round(Math.abs(diff) * 100, 0), games: sameHero.length } });
    }
  }
  const topBenchmark = benchmarks.reduce<(typeof benchmarks)[number] | null>((x, b) => (!x || b.percentile > x.percentile ? b : x), null);
  const lowBenchmark = benchmarks.reduce<(typeof benchmarks)[number] | null>((x, b) => (!x || b.percentile < x.percentile ? b : x), null);
  if (topBenchmark && topBenchmark.percentile >= 90) highlights.push({ code: 'topBenchmark', tone: 'good', values: { metric: topBenchmark.key, percentile: topBenchmark.percentile } });
  if (lowBenchmark && lowBenchmark.percentile <= 10) highlights.push({ code: 'lowBenchmark', tone: 'bad', values: { metric: lowBenchmark.key, percentile: lowBenchmark.percentile } });

  if (won !== null && match.radiantGoldAdvantage.length > 0) {
    // The largest gold lead held at any point by the team that ended up losing.
    const loserPeak = match.radiantWin ? -Math.min(0, ...match.radiantGoldAdvantage) : Math.max(0, ...match.radiantGoldAdvantage);
    if (loserPeak >= NOTABLE_SWING_GOLD) {
      highlights.push(won ? { code: 'comeback', tone: 'good', values: { gold: loserPeak } } : { code: 'thrownLead', tone: 'bad', values: { gold: loserPeak } });
    }
  }

  return {
    won,
    isRadiant,
    kda: kdaRatio(player.kills, player.deaths, player.assists),
    teamShare: {
      killParticipation,
      heroDamage: teamSharePct(team, player, (p) => p.heroDamage),
      towerDamage: teamSharePct(team, player, (p) => p.towerDamage),
      netWorth: teamSharePct(team, player, (p) => p.netWorth),
    },
    teamRank: rank,
    benchmarks,
    comparison,
    heroGames: sameHero.length,
    overallGames: similar.length,
    detail: {
      laneEfficiencyPct: player.laneEfficiencyPct,
      observersPlaced: player.observersPlaced,
      sentriesPlaced: player.sentriesPlaced,
      stunSeconds: player.stunSeconds === null ? null : round(player.stunSeconds, 1),
      campsStacked: player.campsStacked,
      runePickups: player.runePickups,
    },
    itemTimings,
    goldTimeline: player.goldTimeline,
    xpTimeline: player.xpTimeline,
    lastHitTimeline: player.lastHitTimeline,
    highlights,
  };
}
