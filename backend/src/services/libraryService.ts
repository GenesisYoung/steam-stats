import {
  achievementPercent, actualCostPerHour, estimatedCostPerHour, minutesToHours, round, steamCoverUrl, steamIconUrl,
  type AnalyticsGame, type AppMetadataDoc, type GameDetailDto, type GameListItemDto, type GameListQuery,
  type OwnedGameDoc, type PurchaseDoc, type UserDoc,
} from '@steam-analytics/shared';
import { errors } from '../lib/errors';
import { toIso } from '../lib/firestore';
import { LruCache } from '../lib/lru';
import type { AppCacheRepository } from '../repositories/appCacheRepository';
import type { PurchaseRepository } from '../repositories/purchaseRepository';
import type { SteamDataRepository } from '../repositories/steamDataRepository';
import type { UserRepository } from '../repositories/userRepository';
import { effectivePrice, toPriceDto, type EffectivePrice } from './pricingService';

export interface LibraryEntry {
  game: OwnedGameDoc;
  meta: AppMetadataDoc | undefined;
  price: EffectivePrice;
  purchase: PurchaseDoc | undefined;
}

export interface Library {
  user: UserDoc & { steamId: string };
  region: string;
  entries: LibraryEntry[];
  lastPriceUpdateAt: Date | null;
}

export function toAnalyticsGame(e: LibraryEntry): AnalyticsGame {
  return {
    appId: e.game.appId,
    name: e.game.name,
    playtimeMinutes: e.game.playtimeForeverMinutes,
    achievements: e.game.achievements,
    price: { status: e.price.status, amount: e.price.amount, currency: e.price.currency },
    isGame: e.meta?.type ? e.meta.type === 'game' : undefined,
    purchase: e.purchase ? { amount: e.purchase.amount, currency: e.purchase.currency } : null,
  };
}

export function toListItem(e: LibraryEntry, region: string): GameListItemDto {
  const g = e.game;
  const ag = toAnalyticsGame(e);
  return {
    appId: g.appId,
    name: g.name,
    coverUrl: steamCoverUrl(g.appId),
    iconUrl: steamIconUrl(g.appId, g.iconHash),
    playtimeForeverMinutes: g.playtimeForeverMinutes,
    playtimeHours: round(minutesToHours(g.playtimeForeverMinutes), 1),
    playtime2WeeksMinutes: g.playtime2WeeksMinutes,
    lastPlayedAt: toIso(g.lastPlayedAt),
    achievements: {
      status: g.achievements.status,
      total: g.achievements.total,
      unlocked: g.achievements.unlocked,
      percent: g.achievements.status === 'available' ? achievementPercent(g.achievements.total, g.achievements.unlocked) : null,
    },
    price: toPriceDto(e.price, region),
    estimatedCostPerHour: estimatedCostPerHour(ag),
    purchase: e.purchase ? { amount: e.purchase.amount, currency: e.purchase.currency } : null,
    actualCostPerHour: actualCostPerHour(ag),
  };
}

type SortValue = number | string | null;
const sortValue = (item: GameListItemDto, key: GameListQuery['sort']): SortValue => {
  switch (key) {
    case 'name': return item.name.toLocaleLowerCase();
    case 'playtime': return item.playtimeForeverMinutes;
    case 'recent': return item.playtime2WeeksMinutes;
    case 'achievements': return item.achievements.percent;
    case 'price': return item.price.price?.amount ?? null;
    case 'costPerHour': return item.estimatedCostPerHour.status === 'ok' ? item.estimatedCostPerHour.value.amount : null;
    case 'lastPlayed': return item.lastPlayedAt;
  }
};
const DEFAULT_ORDER: Record<GameListQuery['sort'], 'asc' | 'desc'> = {
  name: 'asc', playtime: 'desc', recent: 'desc', achievements: 'desc', price: 'desc', costPerHour: 'asc', lastPlayed: 'desc',
};

/** Filter, sort (unknown values always last) and paginate. */
export function queryGames(items: GameListItemDto[], q: GameListQuery) {
  const needle = q.q?.toLocaleLowerCase();
  const filtered = items.filter((g) => {
    if (needle && !g.name.toLocaleLowerCase().includes(needle) && String(g.appId) !== needle) return false;
    if (q.played === 'yes' && g.playtimeForeverMinutes <= 0) return false;
    if (q.played === 'no' && g.playtimeForeverMinutes > 0) return false;
    const hasAch = g.achievements.status === 'available' && (g.achievements.total ?? 0) > 0;
    if (q.achievements === 'yes' && !hasAch) return false;
    if (q.achievements === 'no' && (hasAch || g.achievements.status === 'unknown')) return false;
    return true;
  });
  const dir = (q.order ?? DEFAULT_ORDER[q.sort]) === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    const va = sortValue(a, q.sort);
    const vb = sortValue(b, q.sort);
    if (va === null && vb === null) return a.name.localeCompare(b.name);
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
    return cmp !== 0 ? cmp * dir : a.name.localeCompare(b.name);
  });
  const start = (q.page - 1) * q.pageSize;
  return { total: filtered.length, items: filtered.slice(start, start + q.pageSize) };
}

const CACHE_TTL_MS = 5 * 60 * 1000;

export class LibraryService {
  private cache = new LruCache<string, { version: number; region: string; library: Library }>(500, CACHE_TTL_MS);

  constructor(
    private readonly users: UserRepository,
    private readonly data: SteamDataRepository,
    private readonly purchases: PurchaseRepository,
    private readonly appCache: AppCacheRepository,
  ) {}

  async requireLinkedUser(uid: string): Promise<UserDoc & { steamId: string }> {
    const user = await this.users.get(uid);
    if (!user) throw errors.notFound('User profile not found');
    if (!user.steamId) throw errors.steamNotLinked();
    return user as UserDoc & { steamId: string };
  }

  /** Full library with prices and purchases; cached per user until data changes. */
  async load(uid: string): Promise<Library> {
    const user = await this.requireLinkedUser(uid);
    const region = user.preferences.storeRegion;
    const cached = this.cache.get(uid);
    if (cached && cached.version === user.dataVersion && cached.region === region && cached.library.user.steamId === user.steamId) {
      return { ...cached.library, user };
    }
    const [games, purchases] = await Promise.all([this.data.listGames(uid), this.purchases.list(uid)]);
    const appIds = games.map((g) => g.appId);
    const [meta, prices] = await Promise.all([this.appCache.getMetadata(appIds), this.appCache.getPrices(appIds, region)]);
    const purchaseMap = new Map(purchases.map((p) => [p.appId, p]));
    let lastPriceUpdateAt: Date | null = null;
    const entries = games.map((game) => {
      const p = prices.get(game.appId);
      if (p && (!lastPriceUpdateAt || p.fetchedAt > lastPriceUpdateAt)) lastPriceUpdateAt = p.fetchedAt;
      return { game, meta: meta.get(game.appId), price: effectivePrice(meta.get(game.appId), p), purchase: purchaseMap.get(game.appId) };
    });
    const library: Library = { user, region, entries, lastPriceUpdateAt };
    this.cache.set(uid, { version: user.dataVersion, region, library });
    return library;
  }

  invalidate(uid: string) {
    this.cache.delete(uid);
  }

  async list(uid: string, q: GameListQuery) {
    const lib = await this.load(uid);
    const { total, items } = queryGames(lib.entries.map((e) => toListItem(e, lib.region)), q);
    return { items, total, lib };
  }

  async detail(uid: string, appId: number): Promise<GameDetailDto> {
    const lib = await this.load(uid);
    const entry = lib.entries.find((e) => e.game.appId === appId);
    if (!entry) throw errors.notFound('Game not found in your library');
    return {
      ...toListItem(entry, lib.region),
      storeType: entry.meta?.type ?? null,
      purchaseRecord: entry.purchase
        ? { ...entry.purchase, createdAt: entry.purchase.createdAt.toISOString(), updatedAt: entry.purchase.updatedAt.toISOString(), userEntered: true }
        : null,
      storeUrl: `https://store.steampowered.com/app/${appId}/`,
    };
  }
}
