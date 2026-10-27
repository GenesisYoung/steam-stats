/**
 * In-memory fake of the Steam endpoints used by the backend. Injected as
 * `fetchImpl` so automated tests never hit real Steam services.
 * Development/test only.
 */
import type { FetchLike } from '../../src/lib/http';

export interface FakeGame {
  appid: number;
  name: string;
  playtime_forever: number;
  playtime_2weeks?: number;
  has_community_visible_stats?: boolean;
  rtime_last_played?: number;
}

export interface FakePlayer {
  steamId: string;
  name: string;
  visibility: 1 | 3;
  gameDetailsPublic: boolean;
  games: FakeGame[];
  level?: number;
  /** appid → apinames unlocked */
  unlocked: Record<number, string[]>;
  achievementsPrivate?: boolean;
}

export interface FakeApp {
  type?: string;
  isFree?: boolean;
  /** cents; undefined = no price_overview; null = success:false (delisted) */
  priceCents?: number | null;
  achievements?: string[];
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export class FakeSteam {
  players = new Map<string, FakePlayer>();
  apps = new Map<number, FakeApp>();
  calls: string[] = [];
  /** Force a status for every call to a given path fragment. */
  failures = new Map<string, number>();
  /** OpenID check_authentication result. */
  openIdValid = true;
  overrides: { match: string; handler: Handler }[] = [];

  addPlayer(p: FakePlayer) {
    this.players.set(p.steamId, p);
    return p;
  }

  fetch: FetchLike = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    this.calls.push(url.pathname);
    for (const o of this.overrides) if (url.pathname.includes(o.match)) return o.handler(url, init);
    for (const [fragment, status] of this.failures) {
      if (url.pathname.includes(fragment)) return json({}, status);
    }
    const q = url.searchParams;
    const player = this.players.get(q.get('steamid') ?? q.get('steamids') ?? '');

    if (url.host === 'steamcommunity.com' && url.pathname === '/openid/login') {
      const body = new URLSearchParams(String(init?.body ?? ''));
      const valid = this.openIdValid && body.get('openid.mode') === 'check_authentication';
      return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`, { status: 200 });
    }
    if (url.pathname.startsWith('/ISteamUser/GetPlayerSummaries')) {
      return json({
        response: {
          players: player
            ? [{
                steamid: player.steamId,
                personaname: player.name,
                profileurl: `https://steamcommunity.com/profiles/${player.steamId}/`,
                avatarfull: 'https://avatars.steamstatic.com/x_full.jpg',
                personastate: 1,
                communityvisibilitystate: player.visibility,
              }]
            : [],
        },
      });
    }
    if (url.pathname.startsWith('/IPlayerService/GetOwnedGames')) {
      if (!player || !player.gameDetailsPublic) return json({ response: {} });
      return json({ response: { game_count: player.games.length, games: player.games } });
    }
    if (url.pathname.startsWith('/IPlayerService/GetRecentlyPlayedGames')) {
      return json({ response: { total_count: 0 } });
    }
    if (url.pathname.startsWith('/IPlayerService/GetSteamLevel')) {
      return json({ response: player?.level !== undefined ? { player_level: player.level } : {} });
    }
    if (url.pathname.startsWith('/ISteamUserStats/GetSchemaForGame')) {
      const app = this.apps.get(Number(q.get('appid')));
      return json({
        game: app?.achievements
          ? { availableGameStats: { achievements: app.achievements.map((name) => ({ name, displayName: `${name} title`, description: `${name} desc`, icon: `https://cdn.example/${name}.jpg`, icongray: `https://cdn.example/${name}_g.jpg`, hidden: 0 })) } }
          : {},
      });
    }
    if (url.pathname.startsWith('/ISteamUserStats/GetGlobalAchievementPercentagesForApp')) {
      const app = this.apps.get(Number(q.get('gameid')));
      if (!app?.achievements) return json({}, 403);
      return json({ achievementpercentages: { achievements: app.achievements.map((name, i) => ({ name, percent: String(50 - i) })) } });
    }
    if (url.pathname.startsWith('/ISteamUserStats/GetPlayerAchievements')) {
      const appId = Number(q.get('appid'));
      const app = this.apps.get(appId);
      if (player?.achievementsPrivate) return json({ playerstats: { error: 'Profile is not public', success: false } }, 403);
      if (!app?.achievements) return json({ playerstats: { error: 'Requested app has no stats', success: false } }, 400);
      const unlocked = new Set(player?.unlocked[appId] ?? []);
      return json({
        playerstats: {
          success: true,
          achievements: app.achievements.map((apiname) => ({ apiname, achieved: unlocked.has(apiname) ? 1 : 0, unlocktime: unlocked.has(apiname) ? 1_700_000_000 : 0 })),
        },
      });
    }
    if (url.host === 'store.steampowered.com' && url.pathname === '/api/appdetails') {
      const ids = (q.get('appids') ?? '').split(',').map(Number);
      const filters = q.get('filters');
      const out: Record<string, unknown> = {};
      for (const id of ids) {
        const app = this.apps.get(id);
        if (!app || app.priceCents === null) {
          out[id] = { success: false };
        } else if (filters === 'basic') {
          out[id] = { success: true, data: { type: app.type ?? 'game', name: `App ${id}`, is_free: app.isFree ?? false } };
        } else {
          out[id] = {
            success: true,
            data: app.priceCents === undefined ? [] : { price_overview: { currency: 'USD', initial: app.priceCents, final: app.priceCents, discount_percent: 0 } },
          };
        }
      }
      return json(out);
    }
    return json({ error: 'unhandled fake endpoint' }, 404);
  };
}
