import {
  analyzeDotaHistory, analyzeMatchPerformance, isRadiantSlot, isRankedLobby, kdaRatio, matchesQueue, matchWon, steamIdToAccountId,
  type DotaHeroRef, type DotaItemInfo, type DotaItemRef, type DotaMatchData, type DotaMatchDetailDto, type DotaMatchListDto,
  type DotaMatchListQuery, type DotaMatchSummary, type DotaOverviewDto, type DotaOverviewQuery,
} from '@steam-analytics/shared';
import { errors } from '../lib/errors';
import { LruCache } from '../lib/lru';
import type { LibraryService } from './libraryService';
import { MATCH_HISTORY_LIMIT, type OpenDotaClient, type OpenDotaHero, type OpenDotaPlayer } from './openDotaClient';

const HISTORY_TTL_MS = 3 * 60 * 1000;
const MATCH_TTL_MS = 24 * 60 * 60 * 1000;
/** An unparsed match may gain replay data at any time, so it is re-checked sooner. */
const UNPARSED_MATCH_TTL_MS = 5 * 60 * 1000;
const CONSTANTS_TTL_MS = 24 * 60 * 60 * 1000;

interface History {
  player: OpenDotaPlayer | null;
  matches: DotaMatchSummary[];
  fetchedAt: Date;
}

interface CachedMatch {
  match: DotaMatchData;
  fetchedAt: number;
}

interface Constants {
  heroes: Map<number, OpenDotaHero>;
  itemsById: Map<number, DotaItemInfo>;
  itemsByKey: Map<string, DotaItemInfo>;
}

/**
 * Dota 2 analysis for the linked Steam account. Match data is public and cheap
 * to fetch again, so it is only cached in memory and never written to Firestore.
 * Caches hold promises so that concurrent requests share one upstream call.
 */
export class DotaService {
  private histories = new LruCache<number, Promise<History>>(100, HISTORY_TTL_MS);
  private matches = new LruCache<number, Promise<CachedMatch | null>>(500, MATCH_TTL_MS);
  private constants = new LruCache<'all', Promise<Constants>>(1, CONSTANTS_TTL_MS);

  constructor(
    private readonly client: OpenDotaClient,
    private readonly library: LibraryService,
  ) {}

  private cached<K, V>(cache: LruCache<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
    const existing = cache.get(key);
    if (existing) return existing;
    const promise = load();
    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
    return promise;
  }

  private async accountId(uid: string): Promise<number> {
    const user = await this.library.requireLinkedUser(uid);
    const accountId = steamIdToAccountId(user.steamId);
    if (accountId === null) throw errors.notFound('This Steam account has no Dota 2 account');
    return accountId;
  }

  private history(accountId: number): Promise<History> {
    return this.cached(this.histories, accountId, async () => {
      const [player, matches] = await Promise.all([this.client.getPlayer(accountId), this.client.getMatchHistory(accountId)]);
      return { player, matches, fetchedAt: new Date() };
    });
  }

  private loadConstants(): Promise<Constants> {
    return this.cached(this.constants, 'all', async () => {
      const [heroes, items] = await Promise.all([this.client.getHeroes(), this.client.getItems()]);
      return {
        heroes: new Map(heroes.map((h) => [h.id, h])),
        itemsById: new Map(items.map((i) => [i.id, i])),
        itemsByKey: new Map(items.map((i) => [i.key, i])),
      };
    });
  }

  private async loadMatch(matchId: number): Promise<CachedMatch | null> {
    const existing = await this.matches.get(matchId);
    if (existing && !existing.match.parsed && Date.now() - existing.fetchedAt > UNPARSED_MATCH_TTL_MS) this.matches.delete(matchId);
    return this.cached(this.matches, matchId, async () => {
      const match = await this.client.getMatch(matchId);
      return match ? { match, fetchedAt: Date.now() } : null;
    });
  }

  async overview(uid: string, q: DotaOverviewQuery): Promise<{ dto: DotaOverviewDto; dataAsOf: string }> {
    const accountId = await this.accountId(uid);
    const [history, constants] = await Promise.all([this.history(accountId), this.loadConstants()]);
    const queue = history.matches.filter((m) => matchesQueue(m, q.queue));
    const selected = q.window === 'all' ? queue : queue.slice(0, Number(q.window));
    const hero = heroRef(constants);
    const analysis = analyzeDotaHistory(selected, (id) => hero(id).name);
    return {
      dataAsOf: history.fetchedAt.toISOString(),
      dto: {
        ...analysis,
        player: {
          accountId,
          personaName: history.player?.personaName ?? null,
          rankTier: history.player?.rankTier ?? null,
          leaderboardRank: history.player?.leaderboardRank ?? null,
        },
        heroRefs: analysis.heroes.map((h) => hero(h.heroId)),
        matchesTotal: history.matches.length,
        truncated: history.matches.length >= MATCH_HISTORY_LIMIT,
      },
    };
  }

  async listMatches(uid: string, q: DotaMatchListQuery): Promise<{ dto: DotaMatchListDto; total: number; dataAsOf: string }> {
    const accountId = await this.accountId(uid);
    const [history, constants] = await Promise.all([this.history(accountId), this.loadConstants()]);
    const hero = heroRef(constants);
    const filtered = history.matches.filter((m) => {
      if (!matchesQueue(m, q.queue)) return false;
      if (q.heroId !== undefined && m.heroId !== q.heroId) return false;
      if (q.result === 'win' && matchWon(m) !== true) return false;
      if (q.result === 'loss' && matchWon(m) !== false) return false;
      return true;
    });
    const start = (q.page - 1) * q.pageSize;
    return {
      total: filtered.length,
      dataAsOf: history.fetchedAt.toISOString(),
      dto: {
        items: filtered.slice(start, start + q.pageSize).map((m) => ({
          matchId: m.matchId,
          startTime: new Date(m.startTime * 1000).toISOString(),
          durationSeconds: m.durationSeconds,
          gameMode: m.gameMode,
          ranked: isRankedLobby(m.lobbyType),
          hero: hero(m.heroId),
          won: matchWon(m),
          isRadiant: isRadiantSlot(m.playerSlot),
          kills: m.kills,
          deaths: m.deaths,
          assists: m.assists,
          kda: kdaRatio(m.kills, m.deaths, m.assists),
          gpm: m.gpm,
          xpm: m.xpm,
          heroDamage: m.heroDamage,
          lastHits: m.lastHits,
        })),
        heroes: [...new Set(history.matches.map((m) => m.heroId))].map(hero).sort((a, b) => a.name.localeCompare(b.name)),
      },
    };
  }

  /** Any public match can be opened; the personal analysis needs the player to be in it. */
  async matchDetail(uid: string, matchId: number): Promise<DotaMatchDetailDto> {
    const accountId = await this.accountId(uid);
    const [cached, constants] = await Promise.all([this.loadMatch(matchId), this.loadConstants()]);
    if (!cached) throw errors.notFound('Match not found');
    const { match } = cached;
    const isPlayer = match.players.some((p) => p.accountId === accountId);
    const history = isPlayer ? (await this.history(accountId)).matches : [];
    const hero = heroRef(constants);
    const item = (id: number): DotaItemRef => {
      const info = constants.itemsById.get(id);
      return { id, name: info?.name ?? `#${id}`, imageUrl: info?.imageUrl ?? null };
    };
    return {
      matchId: match.matchId,
      startTime: new Date(match.startTime * 1000).toISOString(),
      durationSeconds: match.durationSeconds,
      gameMode: match.gameMode,
      ranked: isRankedLobby(match.lobbyType),
      radiantWin: match.radiantWin,
      radiantScore: match.radiantScore,
      direScore: match.direScore,
      parsed: match.parsed,
      radiantGoldAdvantage: match.radiantGoldAdvantage,
      radiantXpAdvantage: match.radiantXpAdvantage,
      players: match.players.map((p) => ({
        accountId: p.accountId,
        isYou: p.accountId === accountId,
        name: p.personaName,
        rankTier: p.rankTier,
        hero: hero(p.heroId),
        isRadiant: isRadiantSlot(p.playerSlot),
        level: p.level,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        lastHits: p.lastHits,
        denies: p.denies,
        gpm: p.gpm,
        xpm: p.xpm,
        heroDamage: p.heroDamage,
        towerDamage: p.towerDamage,
        heroHealing: p.heroHealing,
        netWorth: p.netWorth,
        items: p.itemIds.map(item),
        neutralItem: p.neutralItemId === null ? null : item(p.neutralItemId),
      })),
      performance: analyzeMatchPerformance(match, accountId, history, constants.itemsByKey),
    };
  }

  async refresh(uid: string): Promise<void> {
    const accountId = await this.accountId(uid);
    await this.client.refreshPlayer(accountId);
    this.histories.delete(accountId);
  }

  async requestParse(uid: string, matchId: number): Promise<void> {
    await this.accountId(uid);
    await this.client.requestParse(matchId);
    this.matches.delete(matchId);
  }
}

function heroRef(constants: Constants) {
  return (id: number): DotaHeroRef => {
    const hero = constants.heroes.get(id);
    return { id, name: hero?.name ?? `#${id}`, iconUrl: hero?.iconUrl ?? null, imageUrl: hero?.imageUrl ?? null };
  };
}
