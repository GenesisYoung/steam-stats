import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, createUser, emulatorsAvailable, resetEmulators } from '../helpers/harness';
import { steamAssertion } from '../helpers/openid';
import type { FakePlayer } from '../helpers/fakeSteam';

const d = emulatorsAvailable ? describe : describe.skip;

const STEAM_A = '76561198000000011';
const STEAM_PRIVATE = '76561198000000012';

d('backend integration (emulators + fake Steam)', () => {
  const h = createHarness();

  const publicPlayer = (): FakePlayer => ({
    steamId: STEAM_A,
    name: 'Gordon',
    visibility: 3,
    gameDetailsPublic: true,
    level: 30,
    games: [
      { appid: 100, name: 'Paid Played', playtime_forever: 120 * 60, playtime_2weeks: 90, has_community_visible_stats: true, rtime_last_played: 1_760_000_000 },
      { appid: 200, name: 'Paid Unplayed', playtime_forever: 0, has_community_visible_stats: true },
      { appid: 300, name: 'Free Game', playtime_forever: 600 },
      { appid: 400, name: 'Delisted Game', playtime_forever: 60 },
      { appid: 500, name: 'Software Tool', playtime_forever: 30 },
    ],
    unlocked: { 100: ['WIN', 'START'] },
  });

  beforeEach(async () => {
    await resetEmulators();
    h.container.appCache.clearMemory();
    h.steam.players.clear();
    h.steam.apps.clear();
    h.steam.failures.clear();
    h.steam.overrides = [];
    h.steam.openIdValid = true;
    h.steam.addPlayer(publicPlayer());
    h.steam.addPlayer({ steamId: STEAM_PRIVATE, name: 'Hidden', visibility: 1, gameDetailsPublic: false, games: [], unlocked: {} });
    h.steam.apps.set(100, { priceCents: 5999, achievements: ['WIN', 'START', 'SECRET', 'EXTRA'] });
    h.steam.apps.set(200, { priceCents: 1999, achievements: ['ONE'] });
    h.steam.apps.set(300, { isFree: true });
    h.steam.apps.set(400, { priceCents: null });
    h.steam.apps.set(500, { priceCents: 999, type: 'application' });
  });

  afterAll(async () => {
    await h.container.sync.wait();
  });

  async function startLink(user: { bearer: string }) {
    const res = await h.http().post('/api/steam/auth').set('Authorization', user.bearer).expect(200);
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const cookie = setCookie.find((c) => c.startsWith('steam_link='))!.split(';')[0]!;
    const redirect = new URL(res.body.data.redirectUrl);
    const returnTo = redirect.searchParams.get('openid.return_to')!;
    const state = new URL(returnTo).searchParams.get('state')!;
    return { cookie, returnTo, state, redirect, setCookie };
  }

  async function callback(link: { cookie: string; returnTo: string; state: string }, steamId: string, opts: { cookie?: string | null; nonce?: string } = {}) {
    const req = h.http().get('/api/steam/callback').query({ state: link.state, ...steamAssertion(link.returnTo, steamId, { nonceSuffix: opts.nonce ?? Math.random().toString(36).slice(2) }) });
    if (opts.cookie !== null) req.set('Cookie', opts.cookie ?? link.cookie);
    const res = await req.expect(303);
    return new URL(res.headers.location!);
  }

  async function linkedUser(steamId = STEAM_A) {
    const user = await createUser(h);
    await h.http().get('/api/me').set('Authorization', user.bearer).expect(200);
    const link = await startLink(user);
    const loc = await callback(link, steamId);
    expect(loc.searchParams.get('status')).toBe('success');
    await h.container.sync.wait();
    return user;
  }

  // ---------- Authentication & authorization ----------

  describe('authentication', () => {
    it('rejects requests without or with invalid tokens', async () => {
      const none = await h.http().get('/api/me').expect(401);
      expect(none.body.error.code).toBe('UNAUTHENTICATED');
      await h.http().get('/api/me').set('Authorization', 'Bearer not-a-token').expect(401);
      await h.http().get('/api/steam/games').expect(401);
    });

    it('creates the profile on first /me and updates preferences with validation', async () => {
      const user = await createUser(h);
      const me = await h.http().get('/api/me').set('Authorization', user.bearer).expect(200);
      expect(me.body.data).toMatchObject({ uid: user.uid, email: user.email, steamId: null, preferences: { currency: 'USD', storeRegion: 'us' } });
      const upd = await h.http().patch('/api/me').set('Authorization', user.bearer).send({ preferences: { language: 'zh-CN' } }).expect(200);
      expect(upd.body.data.preferences.language).toBe('zh-CN');
      const bad = await h.http().patch('/api/me').set('Authorization', user.bearer).send({ preferences: { currency: 'XXX' } }).expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
      await h.http().patch('/api/me').set('Authorization', user.bearer).send({ steamId: STEAM_A }).expect(400);
    });

    it('requires a verified email to link Steam', async () => {
      const user = await createUser(h, { verified: false });
      const res = await h.http().post('/api/steam/auth').set('Authorization', user.bearer).expect(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('returns STEAM_NOT_LINKED for Steam data before linking', async () => {
      const user = await createUser(h);
      await h.http().get('/api/me').set('Authorization', user.bearer);
      const res = await h.http().get('/api/steam/games').set('Authorization', user.bearer).expect(409);
      expect(res.body.error.code).toBe('STEAM_NOT_LINKED');
    });

    it('isolates users from each other', async () => {
      const a = await linkedUser();
      const b = await createUser(h);
      await h.http().get('/api/me').set('Authorization', b.bearer);
      await h.http().get('/api/steam/games/100').set('Authorization', b.bearer).expect(409);
      await h.http().put('/api/purchases/100').set('Authorization', b.bearer).send({ amount: 1, currency: 'USD' }).expect(409);
      const listA = await h.http().get('/api/steam/games').set('Authorization', a.bearer).expect(200);
      expect(listA.body.meta.total).toBe(5);
    });
  });

  // ---------- Steam OpenID linking ----------

  describe('steam linking', () => {
    it('issues a bound, HttpOnly linking cookie and a Steam redirect', async () => {
      const user = await createUser(h);
      await h.http().get('/api/me').set('Authorization', user.bearer);
      const link = await startLink(user);
      expect(link.redirect.origin).toBe('https://steamcommunity.com');
      expect(link.redirect.searchParams.get('openid.realm')).toBe('http://localhost:5173');
      expect(link.setCookie.join(';')).toMatch(/HttpOnly/i);
      expect(link.setCookie.join(';')).toMatch(/SameSite=Lax/i);
    });

    it('links on a valid callback and runs the initial sync', async () => {
      const user = await linkedUser();
      const me = await h.http().get('/api/me').set('Authorization', user.bearer).expect(200);
      expect(me.body.data.steamId).toBe(STEAM_A);
      expect(me.body.data.lastSuccessfulSyncAt).not.toBeNull();
      expect((await h.db.doc(`steamLinks/${STEAM_A}`).get()).data()?.uid).toBe(user.uid);
    });

    it('rejects a callback without the initiating browser cookie (link hijacking)', async () => {
      const user = await createUser(h);
      await h.http().get('/api/me').set('Authorization', user.bearer);
      const link = await startLink(user);
      expect((await callback(link, STEAM_A, { cookie: null })).searchParams.get('reason')).toBe('invalid_state');
      expect((await callback(link, STEAM_A, { cookie: 'steam_link=forged' })).searchParams.get('reason')).toBe('invalid_state');
    });

    it('rejects replays of a used linking session', async () => {
      const user = await createUser(h);
      await h.http().get('/api/me').set('Authorization', user.bearer);
      const link = await startLink(user);
      expect((await callback(link, STEAM_A, { nonce: 'n1' })).searchParams.get('status')).toBe('success');
      await h.container.sync.wait();
      expect((await callback(link, STEAM_A, { nonce: 'n1' })).searchParams.get('reason')).toBe('replay');
    });

    it('rejects signatures Steam does not confirm', async () => {
      const user = await createUser(h);
      await h.http().get('/api/me').set('Authorization', user.bearer);
      h.steam.openIdValid = false;
      const link = await startLink(user);
      expect((await callback(link, STEAM_A)).searchParams.get('reason')).toBe('verification_failed');
      const me = await h.http().get('/api/me').set('Authorization', user.bearer);
      expect(me.body.data.steamId).toBeNull();
    });

    it('handles cancellation', async () => {
      const user = await createUser(h);
      await h.http().get('/api/me').set('Authorization', user.bearer);
      const link = await startLink(user);
      const res = await h.http().get('/api/steam/callback').query({ state: link.state, 'openid.mode': 'cancel' }).set('Cookie', link.cookie).expect(303);
      expect(new URL(res.headers.location!).searchParams.get('reason')).toBe('cancelled');
    });

    it('prevents one SteamID from being linked to two accounts', async () => {
      await linkedUser();
      const other = await createUser(h);
      await h.http().get('/api/me').set('Authorization', other.bearer);
      const link = await startLink(other);
      expect((await callback(link, STEAM_A)).searchParams.get('reason')).toBe('already_linked');
      const me = await h.http().get('/api/me').set('Authorization', other.bearer);
      expect(me.body.data.steamId).toBeNull();
    });

    it('refuses to start linking when already linked, and unlinks cleanly', async () => {
      const user = await linkedUser();
      const again = await h.http().post('/api/steam/auth').set('Authorization', user.bearer).expect(409);
      expect(again.body.error.code).toBe('STEAM_ALREADY_LINKED');
      await h.http().put('/api/purchases/100').set('Authorization', user.bearer).send({ amount: 30, currency: 'USD' }).expect(200);
      await h.http().delete('/api/steam/link').set('Authorization', user.bearer).expect(204);
      expect((await h.db.doc(`steamLinks/${STEAM_A}`).get()).exists).toBe(false);
      expect((await h.db.collection(`users/${user.uid}/games`).get()).size).toBe(0);
      expect((await h.db.doc(`users/${user.uid}/gamePurchases/100`).get()).exists).toBe(true);
      // After unlinking, another account may link the same SteamID.
      await linkedUser();
    });
  });

  // ---------- Sync ----------

  describe('synchronization', () => {
    it('syncs profile, library, achievements, prices and a snapshot', async () => {
      const user = await linkedUser();
      const status = await h.http().get('/api/steam/sync/status').set('Authorization', user.bearer).expect(200);
      expect(status.body.data.latest).toMatchObject({ status: 'succeeded', trigger: 'link', stats: { gamesTotal: 5 } });
      expect(status.body.data.active).toBeNull();
      const profile = await h.http().get('/api/steam/profile').set('Authorization', user.bearer).expect(200);
      expect(profile.body.data).toMatchObject({ personaName: 'Gordon', steamLevel: 30, gameDetailsVisible: true, library: { totalGames: 5, totalAchievementsUnlocked: 2 } });
      const snaps = await h.db.collection(`users/${user.uid}/playtimeSnapshots`).get();
      expect(snaps.size).toBe(1);
    });

    it('reports private game details as a failed sync, not as an empty library', async () => {
      const user = await createUser(h);
      await h.http().get('/api/me').set('Authorization', user.bearer);
      const link = await startLink(user);
      await callback(link, STEAM_PRIVATE);
      await h.container.sync.wait();
      const status = await h.http().get('/api/steam/sync/status').set('Authorization', user.bearer);
      expect(status.body.data.latest).toMatchObject({ status: 'failed', error: { code: 'STEAM_PROFILE_PRIVATE' } });
      const profile = await h.http().get('/api/steam/profile').set('Authorization', user.bearer).expect(200);
      expect(profile.body.data.communityVisibility).toBe('private');
      expect(profile.body.data.library.totalGames).toBeNull();
      expect(profile.body.data.library.totalPlaytimeMinutes).toBeNull();
    });

    it('records Steam API failures and releases the lock', async () => {
      const user = await linkedUser();
      h.steam.failures.set('GetOwnedGames', 503);
      await h.container.refs.user(user.uid).update({ lastSuccessfulSyncAt: new Date(0) });
      await h.http().post('/api/steam/sync').set('Authorization', user.bearer).send({ scope: 'full' }).expect(202);
      await h.container.sync.wait();
      const status = await h.http().get('/api/steam/sync/status').set('Authorization', user.bearer);
      expect(status.body.data.latest).toMatchObject({ status: 'failed', error: { code: 'STEAM_UNAVAILABLE' } });
      expect(status.body.data.active).toBeNull();
      // Previously synced data remains available.
      await h.http().get('/api/steam/games').set('Authorization', user.bearer).expect(200);
    });

    it('prevents concurrent jobs and enforces the full-sync cooldown', async () => {
      const user = await linkedUser();
      const cooldown = await h.http().post('/api/steam/sync').set('Authorization', user.bearer).send({ scope: 'full' }).expect(429);
      expect(cooldown.body.error.code).toBe('RATE_LIMITED');
      let release!: () => void;
      h.steam.overrides.push({
        match: 'GetPlayerSummaries',
        handler: async () => {
          await new Promise<void>((r) => (release = r));
          h.steam.overrides = [];
          return h.steam.fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?steamids=${STEAM_A}`);
        },
      });
      await h.http().post('/api/steam/sync').set('Authorization', user.bearer).send({ scope: 'profile' }).expect(202);
      const second = await h.http().post('/api/steam/sync').set('Authorization', user.bearer).send({ scope: 'profile' }).expect(409);
      expect(second.body.error.code).toBe('SYNC_IN_PROGRESS');
      while (!release) await new Promise((r) => setTimeout(r, 10));
      release();
      await h.container.sync.wait();
      await h.http().post('/api/steam/sync').set('Authorization', user.bearer).send({ scope: 'profile' }).expect(202);
      await h.container.sync.wait();
    });

    it('runs scheduled syncs only with the cron secret', async () => {
      await linkedUser();
      await h.http().post('/internal/cron/sync').expect(403);
      await h.http().post('/internal/cron/sync').set('X-Cron-Secret', 'wrong').expect(403);
      const ok = await h.http().post('/internal/cron/sync').set('X-Cron-Secret', 'c'.repeat(40)).expect(200);
      expect(ok.body.data).toHaveProperty('attempted');
    });
  });

  // ---------- Library, prices, cost per hour ----------

  describe('library and analytics', () => {
    it('lists games with explicit unavailable / not-played states', async () => {
      const user = await linkedUser();
      const res = await h.http().get('/api/steam/games').query({ sort: 'name' }).set('Authorization', user.bearer).expect(200);
      const byId = Object.fromEntries(res.body.data.map((g: { appId: number }) => [g.appId, g]));
      expect(byId[100]).toMatchObject({ playtimeHours: 120, price: { status: 'priced', price: { amount: 59.99, currency: 'USD' } }, achievements: { status: 'available', total: 4, unlocked: 2, percent: 50 } });
      expect(byId[100].estimatedCostPerHour.status).toBe('ok');
      expect(byId[100].estimatedCostPerHour.value.amount).toBeCloseTo(0.5, 2);
      expect(byId[200].estimatedCostPerHour).toEqual({ status: 'not_played' });
      expect(byId[300].price.status).toBe('free');
      expect(byId[300].achievements.status).toBe('none');
      expect(byId[400].price.status).toBe('unavailable');
      expect(byId[400].estimatedCostPerHour).toEqual({ status: 'no_price' });
      expect(byId[100].lastPlayedAt).toBe(new Date(1_760_000_000 * 1000).toISOString());
      expect(byId[200].lastPlayedAt).toBeNull();
    });

    it('validates list queries', async () => {
      const user = await linkedUser();
      await h.http().get('/api/steam/games').query({ sort: 'evil' }).set('Authorization', user.bearer).expect(400);
      await h.http().get('/api/steam/games').query({ pageSize: 10_000 }).set('Authorization', user.bearer).expect(400);
      await h.http().get('/api/steam/games/abc').set('Authorization', user.bearer).expect(400);
      await h.http().get('/api/steam/games/999').set('Authorization', user.bearer).expect(404);
    });

    it('returns detailed achievements with metadata', async () => {
      const user = await linkedUser();
      const res = await h.http().get('/api/steam/games/100/achievements').set('Authorization', user.bearer).expect(200);
      expect(res.body.data).toMatchObject({ status: 'available', total: 4, unlocked: 2, percent: 50 });
      const win = res.body.data.achievements.find((a: { apiName: string }) => a.apiName === 'WIN');
      expect(win).toMatchObject({ unlocked: true, displayName: 'WIN title', globalPercent: 50 });
      expect(win.unlockedAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
      const none = await h.http().get('/api/steam/games/300/achievements').set('Authorization', user.bearer).expect(200);
      expect(none.body.data).toMatchObject({ status: 'none', achievements: [] });
    });

    it('computes library value without counting unknown prices or non-games', async () => {
      const user = await linkedUser();
      const res = await h.http().get('/api/analytics/library-value').set('Authorization', user.bearer).expect(200);
      expect(res.body.data.estimated).toMatchObject({
        region: 'us',
        totals: [{ currency: 'USD', amount: 79.98, count: 2 }],
        pricedGames: 2, freeGames: 1, unavailableGames: 1, excludedNonGames: 1,
      });
      expect(res.body.data.recorded).toMatchObject({ totals: [], purchaseCount: 0, disclaimer: 'user_entered_unverified' });
    });

    it('handles purchases and actual cost per hour by currency', async () => {
      const user = await linkedUser();
      await h.http().put('/api/purchases/100').set('Authorization', user.bearer).send({ amount: 30, currency: 'EUR', purchaseDate: '2024-05-01', source: 'steam', notes: 'Sale' }).expect(200);
      await h.http().put('/api/purchases/200').set('Authorization', user.bearer).send({ amount: 10, currency: 'USD' }).expect(200);
      await h.http().put('/api/purchases/999').set('Authorization', user.bearer).send({ amount: 10, currency: 'USD' }).expect(404);
      await h.http().put('/api/purchases/100').set('Authorization', user.bearer).send({ amount: -5, currency: 'USD' }).expect(400);

      const list = await h.http().get('/api/purchases').set('Authorization', user.bearer).expect(200);
      expect(list.body.data).toHaveLength(2);
      expect(list.body.data[0].userEntered).toBe(true);

      const value = await h.http().get('/api/analytics/library-value').set('Authorization', user.bearer).expect(200);
      expect(value.body.data.recorded.totals).toEqual(expect.arrayContaining([{ currency: 'EUR', amount: 30, count: 1 }, { currency: 'USD', amount: 10, count: 1 }]));

      const ce = await h.http().get('/api/analytics/cost-efficiency').query({ basis: 'actual' }).set('Authorization', user.bearer).expect(200);
      expect(ce.body.data.items).toHaveLength(1);
      expect(ce.body.data.items[0]).toMatchObject({ appId: 100, actual: { status: 'ok', value: { currency: 'EUR', amount: 0.25 } } });
      expect(ce.body.data.notPlayedCount).toBe(1);

      await h.http().delete('/api/purchases/200').set('Authorization', user.bearer).expect(204);
      await h.http().delete('/api/purchases/200').set('Authorization', user.bearer).expect(404);
    });

    it('serves overview, playtime and achievement analytics', async () => {
      const user = await linkedUser();
      const ov = await h.http().get('/api/analytics/overview').set('Authorization', user.bearer).expect(200);
      expect(ov.body.data).toMatchObject({ totalGames: 5, playedGames: 4, unplayedGames: 1, totalPlaytimeMinutes: 7200 + 600 + 60 + 30, mostPlayed: { appId: 100 } });
      const pt = await h.http().get('/api/analytics/playtime').set('Authorization', user.bearer).expect(200);
      expect(pt.body.data.top10[0]).toMatchObject({ appId: 100 });
      expect(pt.body.data.trend.daily).toEqual([]);
      expect(pt.body.data.trend.trackingStartedAt).not.toBeNull();
      const ach = await h.http().get('/api/analytics/achievements').set('Authorization', user.bearer).expect(200);
      expect(ach.body.data).toMatchObject({ totalUnlocked: 2, totalAvailable: 5, completionRate: 40 });
    });
  });

  // ---------- Account deletion ----------

  describe('account deletion', () => {
    it('requires a recent sign-in', async () => {
      const user = await linkedUser();
      const authUser = { uid: user.uid, email: user.email, emailVerified: true, name: undefined, authTime: Math.floor(Date.now() / 1000) };
      await expect(h.container.account.delete(authUser, Date.now() + 10 * 60 * 1000)).rejects.toMatchObject({ code: 'RECENT_LOGIN_REQUIRED' });
    });

    it('deletes all data, the Steam mapping and the auth user', async () => {
      const user = await linkedUser();
      await h.http().delete('/api/me').set('Authorization', user.bearer).expect(204);
      expect((await h.db.doc(`users/${user.uid}`).get()).exists).toBe(false);
      expect((await h.db.collection(`users/${user.uid}/games`).get()).size).toBe(0);
      expect((await h.db.doc(`steamLinks/${STEAM_A}`).get()).exists).toBe(false);
      await expect(h.auth.getUser(user.uid)).rejects.toBeTruthy();
    });
  });
});
