/**
 * Typed client for the documented Steam Web API (api.steampowered.com).
 * Every response is validated with Zod; unexpected shapes become UpstreamErrors
 * instead of silently producing wrong statistics.
 */
import { z } from 'zod';
import { UpstreamError } from '../lib/errors';
import { requestJson, TokenBucket, type FetchLike } from '../lib/http';

const BASE = 'https://api.steampowered.com';

const playerSchema = z.object({
  steamid: z.string(),
  personaname: z.string(),
  profileurl: z.string(),
  avatarfull: z.string(),
  personastate: z.number().int().optional(),
  communityvisibilitystate: z.number().int(),
  gameid: z.string().optional(),
  gameextrainfo: z.string().optional(),
});
export type SteamPlayer = z.infer<typeof playerSchema>;

const summariesSchema = z.object({ response: z.object({ players: z.array(playerSchema) }) });

const ownedGameSchema = z.object({
  appid: z.number().int(),
  name: z.string().optional(),
  playtime_forever: z.number().int().min(0),
  playtime_2weeks: z.number().int().min(0).optional(),
  img_icon_url: z.string().optional(),
  has_community_visible_stats: z.boolean().optional(),
  rtime_last_played: z.number().int().min(0).optional(),
});
export type SteamOwnedGame = z.infer<typeof ownedGameSchema>;

const ownedGamesSchema = z.object({
  response: z.object({ game_count: z.number().int().optional(), games: z.array(ownedGameSchema).optional() }),
});

const recentSchema = z.object({
  response: z.object({
    total_count: z.number().int().optional(),
    games: z
      .array(z.object({ appid: z.number().int(), name: z.string().optional(), playtime_2weeks: z.number().int(), playtime_forever: z.number().int() }))
      .optional(),
  }),
});

const levelSchema = z.object({ response: z.object({ player_level: z.number().int().optional() }) });

const playerAchievementsSchema = z.object({
  playerstats: z.object({
    success: z.boolean(),
    error: z.string().optional(),
    achievements: z
      .array(z.object({ apiname: z.string(), achieved: z.number().int(), unlocktime: z.number().int().optional() }))
      .optional(),
  }),
});

const schemaForGameSchema = z.object({
  game: z.object({
    availableGameStats: z
      .object({
        achievements: z
          .array(
            z.object({
              name: z.string(),
              displayName: z.string().optional(),
              description: z.string().optional(),
              icon: z.string().optional(),
              icongray: z.string().optional(),
              hidden: z.number().int().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  }).optional(),
});

const globalPctSchema = z.object({
  achievementpercentages: z.object({
    achievements: z.array(z.object({ name: z.string(), percent: z.union([z.number(), z.string()]) })),
  }),
});

export type PlayerAchievementsResult =
  | { status: 'ok'; achievements: { apiName: string; achieved: boolean; unlockTime: number }[] }
  | { status: 'no_stats' }
  | { status: 'private' };

/** Steam language identifiers for the supported UI languages. */
export const steamLanguage = (lang: string) => (lang === 'zh-CN' ? 'schinese' : 'english');

export interface SteamApiClientOptions {
  apiKey: string;
  fetchImpl?: FetchLike;
  /** Defaults: burst 10, 5 req/s — well under the 100k/day key limit. */
  limiter?: TokenBucket;
  retries?: number;
}

export class SteamApiClient {
  private readonly limiter: TokenBucket;

  constructor(private readonly opts: SteamApiClientOptions) {
    this.limiter = opts.limiter ?? new TokenBucket(10, 5);
  }

  private async call<T>(path: string, params: Record<string, string | number | boolean>, schema: z.ZodType<T>, passStatuses: number[] = []): Promise<{ status: number; data: T }> {
    const qs = new URLSearchParams({ key: this.opts.apiKey, format: 'json' });
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    const { status, json } = await requestJson(`${BASE}/${path}?${qs}`, {
      service: 'steam-web-api',
      limiter: this.limiter,
      fetchImpl: this.opts.fetchImpl,
      retries: this.opts.retries,
      passStatuses,
    });
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new UpstreamError('steam-web-api', status, `Unexpected response shape from ${path.split('/')[1]}`);
    return { status, data: parsed.data };
  }

  async getPlayerSummary(steamId: string): Promise<SteamPlayer | null> {
    const { data } = await this.call('ISteamUser/GetPlayerSummaries/v2/', { steamids: steamId }, summariesSchema);
    return data.response.players.find((p) => p.steamid === steamId) ?? null;
  }

  /**
   * Returns `visible: false` when Steam returns an empty response, which is
   * what happens when the profile's game details are private.
   */
  async getOwnedGames(steamId: string): Promise<{ visible: boolean; games: SteamOwnedGame[] }> {
    const { data } = await this.call(
      'IPlayerService/GetOwnedGames/v1/',
      { steamid: steamId, include_appinfo: true, include_played_free_games: true },
      ownedGamesSchema,
    );
    const visible = data.response.game_count !== undefined;
    return { visible, games: data.response.games ?? [] };
  }

  async getRecentlyPlayedGames(steamId: string) {
    const { data } = await this.call('IPlayerService/GetRecentlyPlayedGames/v1/', { steamid: steamId, count: 10 }, recentSchema);
    return data.response.games ?? [];
  }

  async getSteamLevel(steamId: string): Promise<number | null> {
    const { data } = await this.call('IPlayerService/GetSteamLevel/v1/', { steamid: steamId }, levelSchema);
    return data.response.player_level ?? null;
  }

  async getPlayerAchievements(steamId: string, appId: number, language: string): Promise<PlayerAchievementsResult> {
    const { status, data } = await this.call(
      'ISteamUserStats/GetPlayerAchievements/v1/',
      { steamid: steamId, appid: appId, l: steamLanguage(language) },
      playerAchievementsSchema,
      [400, 403],
    );
    const stats = data.playerstats;
    if (!stats.success) {
      if (status === 403 || /not public|private/i.test(stats.error ?? '')) return { status: 'private' };
      return { status: 'no_stats' };
    }
    return {
      status: 'ok',
      achievements: (stats.achievements ?? []).map((a) => ({ apiName: a.apiname, achieved: a.achieved === 1, unlockTime: a.unlocktime ?? 0 })),
    };
  }

  async getSchemaForGame(appId: number, language: string) {
    const { data } = await this.call(
      'ISteamUserStats/GetSchemaForGame/v2/',
      { appid: appId, l: steamLanguage(language) },
      schemaForGameSchema,
      [400, 403],
    );
    return (data.game?.availableGameStats?.achievements ?? []).map((a) => ({
      apiName: a.name,
      displayName: a.displayName?.trim() || a.name,
      description: a.description?.trim() || null,
      icon: a.icon || null,
      iconGray: a.icongray || null,
      hidden: a.hidden === 1,
    }));
  }

  async getGlobalAchievementPercentages(appId: number): Promise<Record<string, number> | null> {
    try {
      const { status, data } = await this.call(
        'ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/',
        { gameid: appId },
        globalPctSchema.or(z.object({}).passthrough()),
        [400, 403, 404],
      );
      if (status >= 400 || !('achievementpercentages' in data)) return null;
      const result: Record<string, number> = {};
      for (const a of (data as z.infer<typeof globalPctSchema>).achievementpercentages.achievements) {
        const n = Number(a.percent);
        if (Number.isFinite(n)) result[a.name] = n;
      }
      return result;
    } catch (err) {
      if (err instanceof UpstreamError) return null;
      throw err;
    }
  }
}
