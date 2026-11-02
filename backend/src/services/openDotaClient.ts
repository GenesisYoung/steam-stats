/**
 * OpenDota public API (api.opendota.com), the source of Dota 2 match data.
 *
 * It only knows matches of accounts that expose public match data in the Dota 2
 * client. Without a key the limit is 60 requests / minute and 3,000 / day, shared
 * by the whole server. Responses are parsed defensively and normalized here so
 * nothing else depends on OpenDota's field names.
 */
import { z } from 'zod';
import type { DotaItemInfo, DotaMatchData, DotaMatchPlayerData, DotaMatchSummary } from '@steam-analytics/shared';
import { UpstreamError } from '../lib/errors';
import { requestJson, TokenBucket, type FetchLike } from '../lib/http';

const BASE = 'https://api.opendota.com/api';
const CDN = 'https://cdn.cloudflare.steamstatic.com';
const SERVICE = 'opendota';

/** Largest history fetched per account. */
export const MATCH_HISTORY_LIMIT = 5000;

const SUMMARY_FIELDS = [
  'duration', 'game_mode', 'lobby_type', 'start_time', 'hero_id', 'player_slot', 'radiant_win', 'kills', 'deaths', 'assists',
  'gold_per_min', 'xp_per_min', 'hero_damage', 'tower_damage', 'hero_healing', 'last_hits', 'party_size',
];

const nullableNumber = z.number().nullish().transform((v) => v ?? null);
const nullableString = z.string().nullish().transform((v) => v ?? null);
const numberList = z.array(z.number()).nullish().transform((v) => v ?? []);

const summarySchema = z.object({
  match_id: z.number(),
  player_slot: z.number(),
  radiant_win: z.boolean().nullish(),
  duration: z.number(),
  game_mode: z.number(),
  lobby_type: z.number(),
  hero_id: z.number(),
  start_time: z.number(),
  kills: nullableNumber,
  deaths: nullableNumber,
  assists: nullableNumber,
  gold_per_min: nullableNumber,
  xp_per_min: nullableNumber,
  hero_damage: nullableNumber,
  tower_damage: nullableNumber,
  hero_healing: nullableNumber,
  last_hits: nullableNumber,
  party_size: nullableNumber,
});

const playerSchema = z.object({
  profile: z.object({ personaname: nullableString }).nullish(),
  rank_tier: nullableNumber,
  leaderboard_rank: nullableNumber,
});

const matchPlayerSchema = z.object({
  account_id: nullableNumber,
  personaname: nullableString,
  rank_tier: nullableNumber,
  hero_id: z.number(),
  player_slot: z.number(),
  level: nullableNumber,
  kills: nullableNumber,
  deaths: nullableNumber,
  assists: nullableNumber,
  last_hits: nullableNumber,
  denies: nullableNumber,
  gold_per_min: nullableNumber,
  xp_per_min: nullableNumber,
  hero_damage: nullableNumber,
  tower_damage: nullableNumber,
  hero_healing: nullableNumber,
  net_worth: nullableNumber,
  item_0: nullableNumber,
  item_1: nullableNumber,
  item_2: nullableNumber,
  item_3: nullableNumber,
  item_4: nullableNumber,
  item_5: nullableNumber,
  item_neutral: nullableNumber,
  benchmarks: z.record(z.string(), z.object({ raw: nullableNumber, pct: nullableNumber })).nullish(),
  lane_efficiency_pct: nullableNumber,
  obs_placed: nullableNumber,
  sen_placed: nullableNumber,
  stuns: nullableNumber,
  camps_stacked: nullableNumber,
  rune_pickups: nullableNumber,
  firstblood_claimed: nullableNumber,
  purchase_log: z.array(z.object({ time: z.number(), key: z.string() })).nullish(),
  gold_t: numberList,
  xp_t: numberList,
  lh_t: numberList,
});

const matchSchema = z.object({
  match_id: z.number(),
  start_time: z.number(),
  duration: z.number(),
  game_mode: z.number(),
  lobby_type: z.number(),
  radiant_win: z.boolean().nullish(),
  radiant_score: nullableNumber,
  dire_score: nullableNumber,
  version: nullableNumber,
  od_data: z.object({ has_parsed: z.boolean().nullish() }).nullish(),
  radiant_gold_adv: numberList,
  radiant_xp_adv: numberList,
  players: z.array(matchPlayerSchema),
});

const heroConstantsSchema = z.record(z.string(), z.object({
  id: z.number(),
  localized_name: z.string(),
  img: nullableString,
  icon: nullableString,
}));

const itemConstantsSchema = z.record(z.string(), z.object({
  id: z.number(),
  dname: nullableString,
  img: nullableString,
  cost: nullableNumber,
}));

export interface OpenDotaPlayer {
  personaName: string | null;
  rankTier: number | null;
  leaderboardRank: number | null;
}

export interface OpenDotaHero {
  id: number;
  name: string;
  iconUrl: string | null;
  imageUrl: string | null;
}

/** Only image paths on the Dota CDN are accepted; the signature query string is dropped. */
function cdnUrl(path: string | null): string | null {
  if (!path || !/^\/apps\/dota2\/[\w./-]+(\?.*)?$/.test(path)) return null;
  return `${CDN}${path.split('?')[0]}`;
}

function toSummary(m: z.infer<typeof summarySchema>): DotaMatchSummary {
  return {
    matchId: m.match_id,
    startTime: m.start_time,
    durationSeconds: m.duration,
    gameMode: m.game_mode,
    lobbyType: m.lobby_type,
    heroId: m.hero_id,
    playerSlot: m.player_slot,
    radiantWin: m.radiant_win ?? null,
    kills: m.kills ?? 0,
    deaths: m.deaths ?? 0,
    assists: m.assists ?? 0,
    gpm: m.gold_per_min,
    xpm: m.xp_per_min,
    heroDamage: m.hero_damage,
    towerDamage: m.tower_damage,
    heroHealing: m.hero_healing,
    lastHits: m.last_hits,
    partySize: m.party_size,
  };
}

function toMatchPlayer(p: z.infer<typeof matchPlayerSchema>): DotaMatchPlayerData {
  return {
    accountId: p.account_id,
    personaName: p.personaname,
    rankTier: p.rank_tier,
    heroId: p.hero_id,
    playerSlot: p.player_slot,
    level: p.level,
    kills: p.kills ?? 0,
    deaths: p.deaths ?? 0,
    assists: p.assists ?? 0,
    lastHits: p.last_hits,
    denies: p.denies,
    gpm: p.gold_per_min,
    xpm: p.xp_per_min,
    heroDamage: p.hero_damage,
    towerDamage: p.tower_damage,
    heroHealing: p.hero_healing,
    // OpenDota reports 0 rather than null when old matches lack this data.
    netWorth: p.net_worth ? p.net_worth : null,
    itemIds: [p.item_0, p.item_1, p.item_2, p.item_3, p.item_4, p.item_5].filter((id): id is number => id !== null && id > 0),
    neutralItemId: p.item_neutral && p.item_neutral > 0 ? p.item_neutral : null,
    benchmarks: p.benchmarks ?? null,
    laneEfficiencyPct: p.lane_efficiency_pct,
    observersPlaced: p.obs_placed,
    sentriesPlaced: p.sen_placed,
    stunSeconds: p.stuns,
    campsStacked: p.camps_stacked,
    runePickups: p.rune_pickups,
    firstBloodClaimed: p.firstblood_claimed === null ? null : p.firstblood_claimed > 0,
    purchaseLog: p.purchase_log ?? [],
    goldTimeline: p.gold_t,
    xpTimeline: p.xp_t,
    lastHitTimeline: p.lh_t,
  };
}

export class OpenDotaClient {
  private readonly limiter: TokenBucket;

  constructor(private readonly opts: { apiKey?: string; fetchImpl?: FetchLike; limiter?: TokenBucket; retries?: number } = {}) {
    // 60 requests / minute without a key; keep a little headroom.
    this.limiter = opts.limiter ?? new TokenBucket(10, 0.9);
  }

  private async call(path: string, params = new URLSearchParams(), opts: { method?: 'GET' | 'POST'; timeoutMs?: number } = {}) {
    if (this.opts.apiKey) params.set('api_key', this.opts.apiKey);
    const query = params.size > 0 ? `?${params}` : '';
    return requestJson(`${BASE}${path}${query}`, {
      service: SERVICE,
      limiter: this.limiter,
      fetchImpl: this.opts.fetchImpl,
      retries: this.opts.retries ?? 3,
      timeoutMs: opts.timeoutMs ?? 15_000,
      method: opts.method,
      passStatuses: [404],
    });
  }

  private parse<S extends z.ZodType>(schema: S, json: unknown): z.output<S> {
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new UpstreamError(SERVICE, 200, 'Unexpected OpenDota response');
    return parsed.data;
  }

  /** null when OpenDota does not know the account. */
  async getPlayer(accountId: number): Promise<OpenDotaPlayer | null> {
    const { status, json } = await this.call(`/players/${accountId}`);
    if (status === 404) return null;
    const p = this.parse(playerSchema, json);
    return { personaName: p.profile?.personaname ?? null, rankTier: p.rank_tier, leaderboardRank: p.leaderboard_rank };
  }

  /** Newest first. significant=0 keeps turbo and other modes OpenDota leaves out by default. */
  async getMatchHistory(accountId: number): Promise<DotaMatchSummary[]> {
    const params = new URLSearchParams({ limit: String(MATCH_HISTORY_LIMIT), significant: '0' });
    for (const field of SUMMARY_FIELDS) params.append('project', field);
    const { status, json } = await this.call(`/players/${accountId}/matches`, params, { timeoutMs: 30_000 });
    if (status === 404) return [];
    return this.parse(z.array(summarySchema), json).map(toSummary);
  }

  /** null when the match does not exist. */
  async getMatch(matchId: number): Promise<DotaMatchData | null> {
    const { status, json } = await this.call(`/matches/${matchId}`, undefined, { timeoutMs: 20_000 });
    if (status === 404) return null;
    const m = this.parse(matchSchema, json);
    // Same for the score: 0 : 0 in a finished match means it was not recorded.
    const scoreKnown = Boolean(m.radiant_score || m.dire_score);
    return {
      matchId: m.match_id,
      startTime: m.start_time,
      durationSeconds: m.duration,
      gameMode: m.game_mode,
      lobbyType: m.lobby_type,
      radiantWin: m.radiant_win ?? null,
      radiantScore: scoreKnown ? m.radiant_score : null,
      direScore: scoreKnown ? m.dire_score : null,
      parsed: m.od_data?.has_parsed ?? m.version !== null,
      radiantGoldAdvantage: m.radiant_gold_adv,
      radiantXpAdvantage: m.radiant_xp_adv,
      players: m.players.map(toMatchPlayer),
    };
  }

  /** Asks OpenDota to fetch the account's latest matches and rank; it happens in the background. */
  async refreshPlayer(accountId: number): Promise<void> {
    await this.call(`/players/${accountId}/refresh`, undefined, { method: 'POST' });
  }

  /** Queues a replay parse (counts as 10 calls towards OpenDota's rate limit). */
  async requestParse(matchId: number): Promise<void> {
    await this.call(`/request/${matchId}`, undefined, { method: 'POST' });
  }

  async getHeroes(): Promise<OpenDotaHero[]> {
    const { json } = await this.call('/constants/heroes');
    return Object.values(this.parse(heroConstantsSchema, json)).map((h) => ({
      id: h.id,
      name: h.localized_name,
      iconUrl: cdnUrl(h.icon),
      imageUrl: cdnUrl(h.img),
    }));
  }

  async getItems(): Promise<DotaItemInfo[]> {
    const { json } = await this.call('/constants/items');
    return Object.entries(this.parse(itemConstantsSchema, json)).map(([key, item]) => ({
      id: item.id,
      key,
      name: item.dname ?? key,
      imageUrl: cdnUrl(item.img),
      cost: item.cost,
    }));
  }
}
