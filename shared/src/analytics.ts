/**
 * Pure statistical calculations. Every function treats unknown data as
 * unknown: missing prices are never counted as zero, and different
 * currencies are never summed together.
 */
import type {
  AchievementTotalsDto, CostPerHourDto, CurrencyTotal, LibraryValueSummary, Money, TopGameDto,
} from './api';
import type { AchievementDataStatus, PriceStatus } from './models';

export interface AnalyticsGame {
  appId: number;
  name: string;
  playtimeMinutes: number;
  achievements: { status: AchievementDataStatus; total: number | null; unlocked: number | null };
  price: { status: PriceStatus | 'unknown'; amount: number | null; currency: string | null };
  /** false when the store classifies the app as non-game (software, demo, …). */
  isGame?: boolean;
  purchase: { amount: number; currency: string } | null;
}

export const minutesToHours = (minutes: number): number => minutes / 60;

/** Round to 2 decimals for money values (avoids float artefacts like 0.30000000000000004). */
export const roundMoney = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export const round = (n: number, digits = 1): number => {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/**
 * Cost per hour = price / played hours.
 * - zero playtime → "not_played" (never divide by zero)
 * - free game → "free"
 * - unknown / unavailable price → "no_price"
 */
export function costPerHour(price: Money | null, priceStatus: PriceStatus | 'unknown' | 'recorded', playtimeMinutes: number): CostPerHourDto {
  if (priceStatus === 'free') return { status: 'free' };
  if (!price || (priceStatus !== 'priced' && priceStatus !== 'recorded')) return { status: 'no_price' };
  if (playtimeMinutes <= 0) return { status: 'not_played' };
  if (price.amount === 0) return { status: 'free' };
  return { status: 'ok', value: { amount: price.amount / minutesToHours(playtimeMinutes), currency: price.currency } };
}

export function estimatedPrice(game: AnalyticsGame): Money | null {
  return game.price.status === 'priced' && game.price.amount !== null && game.price.currency
    ? { amount: game.price.amount, currency: game.price.currency }
    : null;
}

export function estimatedCostPerHour(game: AnalyticsGame): CostPerHourDto {
  return costPerHour(estimatedPrice(game), game.price.status, game.playtimeMinutes);
}

export function actualCostPerHour(game: AnalyticsGame): CostPerHourDto | null {
  if (!game.purchase) return null;
  return costPerHour(game.purchase, 'recorded', game.playtimeMinutes);
}

export function sumByCurrency(items: Money[]): CurrencyTotal[] {
  const map = new Map<string, CurrencyTotal>();
  for (const { amount, currency } of items) {
    const entry = map.get(currency) ?? { currency, amount: 0, count: 0 };
    entry.amount += amount;
    entry.count += 1;
    map.set(currency, entry);
  }
  return [...map.values()]
    .map((t) => ({ ...t, amount: roundMoney(t.amount) }))
    .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency));
}

export interface PlaytimeSummary {
  totalPlaytimeMinutes: number;
  playedGames: number;
  unplayedGames: number;
  averagePlaytimePerPlayedGameMinutes: number | null;
  mostPlayed: TopGameDto | null;
  top: TopGameDto[];
}

export function summarizePlaytime(games: Pick<AnalyticsGame, 'appId' | 'name' | 'playtimeMinutes'>[], topN = 10): PlaytimeSummary {
  const total = games.reduce((sum, g) => sum + Math.max(0, g.playtimeMinutes), 0);
  const played = games.filter((g) => g.playtimeMinutes > 0);
  const share = (m: number) => (total > 0 ? round((m / total) * 100, 2) : 0);
  const top = [...played]
    .sort((a, b) => b.playtimeMinutes - a.playtimeMinutes || a.name.localeCompare(b.name))
    .slice(0, topN)
    .map((g) => ({ appId: g.appId, name: g.name, playtimeMinutes: g.playtimeMinutes, share: share(g.playtimeMinutes) }));
  return {
    totalPlaytimeMinutes: total,
    playedGames: played.length,
    unplayedGames: games.length - played.length,
    averagePlaytimePerPlayedGameMinutes: played.length > 0 ? total / played.length : null,
    mostPlayed: top[0] ?? null,
    top,
  };
}

export const PLAYTIME_BUCKETS: { bucket: string; minHours: number; maxHours: number | null }[] = [
  { bucket: '0h', minHours: 0, maxHours: 0 },
  { bucket: '<1h', minHours: 0, maxHours: 1 },
  { bucket: '1-10h', minHours: 1, maxHours: 10 },
  { bucket: '10-50h', minHours: 10, maxHours: 50 },
  { bucket: '50-100h', minHours: 50, maxHours: 100 },
  { bucket: '100-500h', minHours: 100, maxHours: 500 },
  { bucket: '500h+', minHours: 500, maxHours: null },
];

export function playtimeDistribution(games: Pick<AnalyticsGame, 'playtimeMinutes'>[]) {
  const counts = PLAYTIME_BUCKETS.map((b) => ({ ...b, count: 0 }));
  for (const g of games) {
    const h = minutesToHours(g.playtimeMinutes);
    const idx = g.playtimeMinutes <= 0 ? 0 : counts.findIndex((b, i) => i > 0 && h >= b.minHours && (b.maxHours === null || h < b.maxHours));
    const bucket = counts[idx];
    if (bucket) bucket.count += 1;
  }
  return counts;
}

export function achievementTotals(games: Pick<AnalyticsGame, 'achievements'>[]): AchievementTotalsDto {
  let totalUnlocked = 0;
  let totalAvailable = 0;
  let gamesWithData = 0;
  let gamesWithoutAchievements = 0;
  let gamesPendingSync = 0;
  let gamesPrivateOrError = 0;
  let perfectGames = 0;
  for (const { achievements: a } of games) {
    switch (a.status) {
      case 'available':
        if (a.total && a.total > 0 && a.unlocked !== null) {
          gamesWithData += 1;
          totalUnlocked += a.unlocked;
          totalAvailable += a.total;
          if (a.unlocked >= a.total) perfectGames += 1;
        } else {
          gamesWithoutAchievements += 1;
        }
        break;
      case 'none':
        gamesWithoutAchievements += 1;
        break;
      case 'unknown':
        gamesPendingSync += 1;
        break;
      default:
        gamesPrivateOrError += 1;
    }
  }
  return {
    totalUnlocked,
    totalAvailable,
    completionRate: totalAvailable > 0 ? round((totalUnlocked / totalAvailable) * 100, 2) : null,
    gamesWithData,
    gamesWithoutAchievements,
    gamesPendingSync,
    gamesPrivateOrError,
    perfectGames,
  };
}

export function achievementPercent(total: number | null, unlocked: number | null): number | null {
  if (total === null || unlocked === null || total <= 0) return null;
  return round((unlocked / total) * 100, 1);
}

export function libraryValue(games: AnalyticsGame[], region: string, lastPriceUpdateAt: string | null): LibraryValueSummary {
  const priced: Money[] = [];
  let freeGames = 0;
  let unavailableGames = 0;
  let unknownGames = 0;
  let excludedNonGames = 0;
  for (const g of games) {
    if (g.isGame === false) {
      excludedNonGames += 1;
      continue;
    }
    const p = estimatedPrice(g);
    if (p) priced.push(p);
    else if (g.price.status === 'free') freeGames += 1;
    else if (g.price.status === 'unavailable') unavailableGames += 1;
    else unknownGames += 1;
  }
  return {
    region,
    totals: sumByCurrency(priced),
    pricedGames: priced.length,
    freeGames,
    unavailableGames,
    unknownGames,
    excludedNonGames,
    lastPriceUpdateAt,
  };
}

/**
 * Average cost per hour per currency: total price of played, priced games
 * divided by their total hours. Unplayed and unpriced games are excluded.
 */
export function averageCostPerHour(entries: { price: Money | null; playtimeMinutes: number }[]): Money[] {
  const acc = new Map<string, { amount: number; minutes: number }>();
  for (const { price, playtimeMinutes } of entries) {
    if (!price || price.amount <= 0 || playtimeMinutes <= 0) continue;
    const e = acc.get(price.currency) ?? { amount: 0, minutes: 0 };
    e.amount += price.amount;
    e.minutes += playtimeMinutes;
    acc.set(price.currency, e);
  }
  return [...acc.entries()].map(([currency, e]) => ({ currency, amount: e.amount / minutesToHours(e.minutes) }));
}

export interface SnapshotPoint {
  date: string;
  games: Record<string, number>;
}

/**
 * Playtime gained between consecutive snapshots, attributed to the later
 * snapshot's date. The first snapshot only establishes a baseline, so no
 * activity before tracking began is ever reported. Negative per-game deltas
 * (refunds, removed games) are ignored.
 */
export function snapshotDeltas(snapshots: SnapshotPoint[]) {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const daily: { date: string; minutes: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    let minutes = 0;
    for (const [appId, m] of Object.entries(cur.games)) {
      minutes += Math.max(0, m - (prev.games[appId] ?? 0));
    }
    daily.push({ date: cur.date, minutes });
  }
  const monthlyMap = new Map<string, number>();
  for (const d of daily) {
    const month = d.date.slice(0, 7);
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + d.minutes);
  }
  return {
    trackingStartedAt: sorted[0]?.date ?? null,
    daily,
    monthly: [...monthlyMap.entries()].map(([month, minutes]) => ({ month, minutes })),
  };
}
