import {
  achievementPercent, achievementTotals, actualCostPerHour, averageCostPerHour, estimatedCostPerHour, estimatedPrice,
  libraryValue, minutesToHours, playtimeDistribution, round, snapshotDeltas, sumByCurrency, summarizePlaytime,
  type AchievementAnalyticsDto, type CostEfficiencyDto, type CostEfficiencyItemDto, type GameValueDto,
  type LibraryValueDto, type OverviewDto, type PlaytimeAnalyticsDto,
} from '@steam-analytics/shared';
import { toIso } from '../lib/firestore';
import type { SteamDataRepository } from '../repositories/steamDataRepository';
import { toAnalyticsGame, type Library, type LibraryService } from './libraryService';

const TOP_N = 10;

function gameValues(lib: Library): GameValueDto[] {
  return lib.entries
    .map(toAnalyticsGame)
    .filter((g) => g.isGame !== false)
    .flatMap((g) => {
      const price = estimatedPrice(g);
      return price ? [{ appId: g.appId, name: g.name, price, playtimeMinutes: g.playtimeMinutes, costPerHour: estimatedCostPerHour(g) }] : [];
    });
}

function bestValue(values: GameValueDto[]): GameValueDto[] {
  return values
    .filter((v) => v.costPerHour.status === 'ok')
    .sort((a, b) => (a.costPerHour.status === 'ok' && b.costPerHour.status === 'ok' ? a.costPerHour.value.amount - b.costPerHour.value.amount : 0))
    .slice(0, TOP_N);
}

export class AnalyticsService {
  constructor(
    private readonly library: LibraryService,
    private readonly data: SteamDataRepository,
  ) {}

  async overview(uid: string): Promise<{ dto: OverviewDto; lib: Library }> {
    const lib = await this.library.load(uid);
    const games = lib.entries.map(toAnalyticsGame);
    const pt = summarizePlaytime(games, TOP_N);
    const values = gameValues(lib);
    return {
      lib,
      dto: {
        totalGames: games.length,
        playedGames: pt.playedGames,
        unplayedGames: pt.unplayedGames,
        totalPlaytimeMinutes: pt.totalPlaytimeMinutes,
        averagePlaytimePerPlayedGameMinutes: pt.averagePlaytimePerPlayedGameMinutes,
        mostPlayed: pt.mostPlayed,
        achievements: achievementTotals(games),
        libraryValue: libraryValue(games, lib.region, toIso(lib.lastPriceUpdateAt)),
        recordedSpending: sumByCurrency(games.flatMap((g) => (g.purchase ? [g.purchase] : []))),
        averageEstimatedCostPerHour: averageCostPerHour(games.filter((g) => g.isGame !== false).map((g) => ({ price: estimatedPrice(g), playtimeMinutes: g.playtimeMinutes }))),
        averageActualCostPerHour: averageCostPerHour(games.map((g) => ({ price: g.purchase, playtimeMinutes: g.playtimeMinutes }))),
        mostExpensive: [...values].sort((a, b) => b.price.amount - a.price.amount).slice(0, TOP_N),
        bestValue: bestValue(values),
      },
    };
  }

  async playtime(uid: string): Promise<{ dto: PlaytimeAnalyticsDto; lib: Library }> {
    const [lib, snapshots] = await Promise.all([this.library.load(uid), this.data.listSnapshots(uid)]);
    const games = lib.entries.map(toAnalyticsGame);
    const pt = summarizePlaytime(games, TOP_N);
    return {
      lib,
      dto: {
        totalPlaytimeMinutes: pt.totalPlaytimeMinutes,
        totalPlaytimeHours: round(minutesToHours(pt.totalPlaytimeMinutes), 1),
        playedGames: pt.playedGames,
        unplayedGames: pt.unplayedGames,
        averagePlaytimePerPlayedGameMinutes: pt.averagePlaytimePerPlayedGameMinutes,
        mostPlayed: pt.mostPlayed,
        top10: pt.top,
        distribution: playtimeDistribution(games),
        trend: snapshotDeltas(snapshots),
      },
    };
  }

  async achievements(uid: string): Promise<{ dto: AchievementAnalyticsDto; lib: Library }> {
    const lib = await this.library.load(uid);
    const games = lib.entries.map(toAnalyticsGame);
    const byGame = games
      .filter((g) => g.achievements.status === 'available' && (g.achievements.total ?? 0) > 0)
      .map((g) => ({
        appId: g.appId,
        name: g.name,
        unlocked: g.achievements.unlocked ?? 0,
        total: g.achievements.total ?? 0,
        percent: achievementPercent(g.achievements.total, g.achievements.unlocked) ?? 0,
      }))
      .sort((a, b) => b.percent - a.percent || b.total - a.total);
    return { lib, dto: { ...achievementTotals(games), byGame } };
  }

  async libraryValue(uid: string): Promise<{ dto: LibraryValueDto; lib: Library }> {
    const lib = await this.library.load(uid);
    const games = lib.entries.map(toAnalyticsGame);
    const purchases = games.flatMap((g) => (g.purchase ? [g.purchase] : []));
    // A bundle is one transaction; its games' shares already add up to the bundle total.
    const records = lib.entries.flatMap((e) => (e.purchase ? [e.purchase] : []));
    const bundleIds = new Set(records.flatMap((p) => (p.bundle ? [p.bundle.id] : [])));
    const singles = records.filter((p) => !p.bundle).length;
    return {
      lib,
      dto: {
        estimated: libraryValue(games, lib.region, toIso(lib.lastPriceUpdateAt)),
        recorded: {
          totals: sumByCurrency(purchases),
          purchaseCount: singles + bundleIds.size,
          bundleCount: bundleIds.size,
          disclaimer: 'user_entered_unverified',
        },
        mostExpensive: gameValues(lib).sort((a, b) => b.price.amount - a.price.amount).slice(0, TOP_N),
      },
    };
  }

  async costEfficiency(uid: string, basis: 'estimated' | 'actual'): Promise<{ dto: CostEfficiencyDto; lib: Library }> {
    const lib = await this.library.load(uid);
    const games = lib.entries.map(toAnalyticsGame).filter((g) => g.isGame !== false || g.purchase);
    const items: CostEfficiencyItemDto[] = games.map((g) => ({
      appId: g.appId,
      name: g.name,
      playtimeMinutes: g.playtimeMinutes,
      estimated: estimatedCostPerHour(g),
      estimatedPrice: estimatedPrice(g),
      actual: actualCostPerHour(g),
      actualPrice: g.purchase,
    }));
    const pick = (i: CostEfficiencyItemDto) => (basis === 'actual' ? i.actual : i.estimated);
    const ranked = items
      .filter((i) => pick(i)?.status === 'ok')
      .sort((a, b) => {
        const va = pick(a);
        const vb = pick(b);
        return va?.status === 'ok' && vb?.status === 'ok' ? va.value.amount - vb.value.amount : 0;
      });
    return {
      lib,
      dto: {
        basis,
        items: ranked,
        lowest: ranked.slice(0, TOP_N),
        highest: ranked.slice(-TOP_N).reverse(),
        averages: {
          estimated: averageCostPerHour(items.map((i) => ({ price: i.estimatedPrice, playtimeMinutes: i.playtimeMinutes }))),
          actual: averageCostPerHour(items.map((i) => ({ price: i.actualPrice, playtimeMinutes: i.playtimeMinutes }))),
        },
        notPlayedCount: items.filter((i) => pick(i)?.status === 'not_played').length,
        noPriceCount: items.filter((i) => {
          const v = pick(i);
          return !v || v.status === 'no_price';
        }).length,
      },
    };
  }
}
